
"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, Check, Download, Loader2, Settings2 } from "lucide-react";
import { Document, Packer, Paragraph, TextRun } from "docx";

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("gemini-3-pro-preview");
  const [transcribedText, setTranscribedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [suggestedFilename, setSuggestedFilename] = useState("transcription");
  const [showSettings, setShowSettings] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList) {
      setFiles((prev) => [...prev, ...Array.from(fileList)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    const newFiles = [...files];
    if (index + direction < 0 || index + direction >= newFiles.length) return;
    const temp = newFiles[index];
    newFiles[index] = newFiles[index + direction];
    newFiles[index + direction] = temp;
    setFiles(newFiles);
  };

  const processFiles = async () => {
    if (files.length === 0) {
      alert("Please upload at least one file.");
      return;
    }

    setIsProcessing(true);
    setTranscribedText(""); // Clear previous text
    setStatusText("Initializing...");
    setSuggestedFilename("transcription"); // Reset filename

    try {
      let accumulatedText = "";

      // Process files sequentially
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setStatusText(`Processing file ${i + 1} of ${files.length}: ${file.name}...`);

        let responseText = "";

        // ALWAYS USE RESUMABLE UPLOAD VIA PROXY (Bypass Vercel 4.5MB limit & CORS)
        setStatusText(`Initializing safe upload for ${file.name}...`);

        try {
          // 0. Robust MIME type detection
          let distinctMimeType = file.type;
          if (!distinctMimeType || distinctMimeType === "application/octet-stream") {
            if (file.name.toLowerCase().endsWith(".pdf")) distinctMimeType = "application/pdf";
            else if (file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg")) distinctMimeType = "image/jpeg";
            else if (file.name.toLowerCase().endsWith(".png")) distinctMimeType = "image/png";
          }
          if (!distinctMimeType) distinctMimeType = "application/pdf";

          // 1. Get Upload URL
          const initRes = await fetch("/api/upload/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mimeType: distinctMimeType, displayName: file.name })
          });

          if (!initRes.ok) {
            const text = await initRes.text();
            throw new Error(`Init failed (${initRes.status}): ${text}`);
          }
          const { uploadUrl } = await initRes.json();

          // 2. Upload CHUNKS via Proxy
          const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB per chunk (Safe for Vercel's 4.5MB limit)
          const totalSize = file.size;
          let offset = 0;
          let fileUri = null;

          while (offset < totalSize) {
            const chunk = file.slice(offset, offset + CHUNK_SIZE);
            const formData = new FormData();
            formData.append("chunk", chunk);
            formData.append("uploadUrl", uploadUrl);
            formData.append("offset", offset.toString());
            formData.append("totalSize", totalSize.toString());

            const percentStart = Math.round((offset / totalSize) * 100);
            const percentEnd = Math.round(((offset + chunk.size) / totalSize) * 100);
            setStatusText(`Uploading ${file.name}... (${percentEnd}%)`);

            const chunkRes = await fetch("/api/upload/chunk", {
              method: "POST",
              body: formData,
            });

            if (!chunkRes.ok) {
              const text = await chunkRes.text();
              throw new Error(`Chunk upload failed: ${text}`);
            }

            const chunkData = await chunkRes.json();

            if (chunkData.status === "finalized") {
              fileUri = chunkData.file.uri;
              break;
            }

            offset += CHUNK_SIZE;
          }

          if (!fileUri) throw new Error("Upload incomplete or failed to get File URI");

          // 3. Transcribe using File URI
          setStatusText(`Analyzing content of ${file.name}...`);
          const transcribeRes = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileUri, mimeType: distinctMimeType, apiKey, modelName })
          });

          const data = await transcribeRes.json();
          if (!transcribeRes.ok) throw new Error(data.error || "Transcription failed");
          responseText = data.text;

        } catch (err: any) {
          console.error(err);
          throw new Error(`Process failed: ${err.message}`);
        }

        // accumulate text
        accumulatedText += responseText + "\n\n"; // Add spacing

        // Update UI immediately
        setTranscribedText(accumulatedText);
      }

      // Auto-generate filename using AI
      if (accumulatedText.trim().length > 0) {
        setStatusText("Generating smart filename...");
        try {
          const titleRes = await fetch("/api/generate-title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: accumulatedText, apiKey }),
          });
          const titleData = await titleRes.json();
          if (titleData.title) {
            setSuggestedFilename(titleData.title);
          }
        } catch (e) {
          console.error("Failed to generate title", e);
        }
      }

      setStatusText("Done!");
    } catch (error: any) {
      console.error("Frontend process error:", error);
      alert("Error: " + error.message);
    } finally {
      setIsProcessing(false);
      setStatusText("");
    }
  };

  const downloadDocx = async () => {
    if (!transcribedText) return;

    try {
      // Preserve newlines by splitting and creating paragraphs
      const paragraphs = transcribedText.split("\n").map(line =>
        new Paragraph({
          children: [new TextRun({ text: line, size: 24 })], // 12pt font
        })
      );

      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs,
        }],
      });

      const blob = await Packer.toBlob(doc);

      // Use the smart filename if available, else default
      const fileName = suggestedFilename ? `${suggestedFilename}.docx` : "transcription.docx";

      // Create download link manually
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Error generating document:", error);
      alert("Failed to generate document.");
    }
  };

  return (
    <main className="min-h-screen p-8 flex flex-col items-center max-w-5xl mx-auto space-y-8 font-sans">

      {/* Header */}
      <header className="w-full flex justify-between items-center pb-6 border-b border-white/10">
        <div>
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400 flex items-center gap-3">
            Gemini Transcriber <span className="text-xs bg-white/10 text-white/50 px-2 py-1 rounded-full border border-white/10">v1.5</span>
          </h1>
          <p className="text-white/60 mt-2">Transcribe Images & PDFs to Word with AI</p>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 rounded-full glass glass-hover text-white/70"
        >
          <Settings2 size={24} />
        </button>
      </header>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="w-full overflow-hidden"
          >
            <div className="glass p-6 rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-white/70 font-medium">Google Gemini API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Leave empty to use server env variable..."
                  className="w-full p-3 rounded-xl glass-input"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-white/70 font-medium">Model Name</label>
                <input
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="e.g., gemini-1.5-pro, gemini-3.0"
                  className="w-full p-3 rounded-xl glass-input"
                />
                <p className="text-xs text-white/40">Enter exact model string (e.g. gemini-1.5-pro)</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Grid */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 h-full flex-grow">

        {/* Left: Upload & File Management */}
        <section className="space-y-4 flex flex-col">
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="border-2 border-dashed border-white/20 rounded-3xl p-10 flex flex-col items-center justify-center text-center transition-colors hover:border-blue-500/50 hover:bg-white/5 cursor-pointer min-h-[200px]"
            onClick={() => document.getElementById('fileInput')?.click()}
          >
            <Upload size={48} className="text-blue-400 mb-4" />
            <p className="text-xl font-medium">Drop files here</p>
            <p className="text-sm text-white/50 mt-1">Images (JPG, PNG) or PDFs</p>
            <input
              id="fileInput"
              type="file"
              multiple
              className="hidden"
              accept="image/*,application/pdf"
              onChange={handleFileSelect}
            />
          </div>

          <div className="glass rounded-3xl p-6 flex-grow flex flex-col space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileText size={20} className="text-purple-400" />
              Files Queue ({files.length})
            </h3>

            <div className="flex-grow overflow-y-auto space-y-2 max-h-[400px] pr-2">
              <AnimatePresence>
                {files.map((file, index) => (
                  <motion.div
                    key={`${file.name}-${index}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex justify-between items-center bg-white/5 p-3 rounded-xl hover:bg-white/10 transition-colors group"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <span className="text-xs font-mono bg-white/10 px-2 py-1 rounded">{index + 1}</span>
                      <span className="truncate text-sm text-white/80">{file.name}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); moveFile(index, -1) }} className="p-1 hover:text-blue-400" disabled={index === 0}>↑</button>
                      <button onClick={(e) => { e.stopPropagation(); moveFile(index, 1) }} className="p-1 hover:text-blue-400" disabled={index === files.length - 1}>↓</button>
                      <button onClick={(e) => { e.stopPropagation(); removeFile(index) }} className="p-1 hover:text-red-400"><X size={16} /></button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {files.length === 0 && (
                <p className="text-center text-white/30 py-10 italic">No files added yet.</p>
              )}
            </div>

            <button
              onClick={processFiles}
              disabled={isProcessing || files.length === 0}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all
                ${isProcessing || files.length === 0 ? 'bg-white/10 text-white/30 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:shadow-lg hover:shadow-purple-500/30 active:scale-95'}
              `}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="animate-spin" style={{ animation: "spin 1s linear infinite" }} />
                  <style jsx global>{`
                    @keyframes spin {
                      from { transform: rotate(0deg); }
                      to { transform: rotate(360deg); }
                    }
                  `}</style>
                  {statusText || "Processing..."}
                </>
              ) : (
                <> <Check /> Start Transcription </>
              )}
            </button>
          </div>
        </section>

        {/* Right: Results */}
        <section className="glass rounded-3xl p-8 flex flex-col h-full min-h-[500px]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-bold">Output</h3>
            {transcribedText && (
              <button
                onClick={downloadDocx}
                className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 flex items-center gap-2 font-medium transition-colors"
              >
                <Download size={18} /> Save .docx
              </button>
            )}
          </div>

          <div className="bg-black/30 w-full flex-grow rounded-xl p-6 overflow-y-auto border border-white/5 font-mono text-sm leading-relaxed whitespace-pre-wrap">
            {transcribedText ? (
              transcribedText
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-white/20">
                <FileText size={64} className="mb-4 opacity-50" />
                <p>Transcription results will appear here.</p>
              </div>
            )}
          </div>
        </section>

      </div>
    </main>
  );
}
