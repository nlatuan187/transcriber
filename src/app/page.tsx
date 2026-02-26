"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, Check, Download, Loader2, Settings2 } from "lucide-react";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument } from "pdf-lib";

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [transcribedText, setTranscribedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [suggestedFilename, setSuggestedFilename] = useState("phien_am");
  const [showSettings, setShowSettings] = useState(false);
  const [modelUsed, setModelUsed] = useState("");
  const [wasFallback, setWasFallback] = useState(false);

  // Helper: Split large PDFs into chunks of 4 pages (v2.1)
  const splitLargePdf = async (file: File): Promise<File[]> => {
    if (file.type !== "application/pdf") return [file];

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const pageCount = pdfDoc.getPageCount();
      const CHUNK_SIZE = 10; // v2.3: Optimized for Flash Models (1M Context / 65k Output)

      if (pageCount <= CHUNK_SIZE) return [file];

      setStatusText(`Đang chia nhỏ PDF lớn (${pageCount} trang)...`);
      const chunks: File[] = [];
      const totalChunks = Math.ceil(pageCount / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, pageCount);

        const subDoc = await PDFDocument.create();
        const indices = Array.from({ length: end - start }, (_, k) => start + k);
        const copiedPages = await subDoc.copyPages(pdfDoc, indices);
        copiedPages.forEach((page) => subDoc.addPage(page));

        const pdfBytes = await subDoc.save();
        const blob = new Blob([pdfBytes as any], { type: "application/pdf" });
        const chunkName = `${file.name.replace(".pdf", "")}_part${i + 1}.pdf`;
        chunks.push(new File([blob], chunkName, { type: "application/pdf" }));
      }
      return chunks;
    } catch (e) {
      console.error("Lỗi chia nhỏ PDF", e);
      return [file]; // Dự phòng nếu chia thất bại
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const incomingFiles = Array.from(e.dataTransfer.files);
      const processedFiles: File[] = [];

      for (const file of incomingFiles) {
        const splits = await splitLargePdf(file);
        processedFiles.push(...splits);
      }

      setFiles((prev) => [...prev, ...processedFiles]);
      setStatusText(""); // Clear "Splitting..." status
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList) {
      const incomingFiles = Array.from(fileList);
      const processedFiles: File[] = [];

      for (const file of incomingFiles) {
        const splits = await splitLargePdf(file);
        processedFiles.push(...splits);
      }

      setFiles((prev) => [...prev, ...processedFiles]);
      setStatusText(""); // Clear "Splitting..." status
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
      alert("Vui lòng tải lên ít nhất một file.");
      return;
    }

    setIsProcessing(true);
    setTranscribedText(""); // Clear previous text
    setStatusText("Đang khởi tạo...");
    setSuggestedFilename("phien_am"); // Đặt lại tên file

    try {
      let accumulatedText = "";

      // Process files sequentially
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setStatusText(`Đang xử lý file ${i + 1}/${files.length}: ${file.name}...`);

        let responseText = "";

        // ALWAYS USE DIRECT CLIENT-SIDE RESUMABLE UPLOAD (v1.6)
        // Bypass Vercel limits by going direct to Google.
        // Adhere to Gemini's strict 8MB (8,388,608 bytes) chunk granularity.
        setStatusText(`Đang khởi tạo tải lên cho ${file.name}...`);

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

          // 2. Upload Directly to Gemini with Strict Chunking
          // Gemini REQUIRES chunks to be multiples of 256KiB. Recommended is 8MB.
          const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB
          const totalSize = file.size;
          let offset = 0;
          let fileUri = null;

          while (offset < totalSize) {
            const chunk = file.slice(offset, offset + CHUNK_SIZE);
            const isLastChunk = offset + chunk.size >= totalSize;

            // CRITICAL: Headers for Gemini Resumable Protocol
            const uploadCommand = isLastChunk ? "upload, finalize" : "upload";

            const percentStart = Math.round((offset / totalSize) * 100);
            const percentEnd = Math.round(((offset + chunk.size) / totalSize) * 100);
            setStatusText(`Đang tải lên ${file.name}... (${percentEnd}%)`);

            const xhr = new XMLHttpRequest();
            await new Promise((resolve, reject) => {
              xhr.open("PUT", uploadUrl);

              xhr.setRequestHeader("Content-Length", chunk.size.toString());
              xhr.setRequestHeader("X-Goog-Upload-Offset", offset.toString());
              xhr.setRequestHeader("X-Goog-Upload-Command", uploadCommand);
              // Content-Type is NOT required for chunks, but good to be safe or leave empty.

              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                  // Calculates progress within this chunk
                }
              };

              xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  if (isLastChunk) {
                    const response = JSON.parse(xhr.response);
                    fileUri = response.file.uri;
                  }
                  resolve(null);
                } else {
                  // Gemini might return 308 Resume Incomplete, which is success for chunks
                  if (xhr.status === 308) {
                    resolve(null);
                  } else {
                    reject(new Error(`Tải lên thất bại (${xhr.status}): ${xhr.statusText}`));
                  }
                }
              };
              xhr.onerror = () => reject(new Error("Lỗi mạng khi tải lên"));

              xhr.send(chunk);
            });

            offset += CHUNK_SIZE;
          }

          if (!fileUri) throw new Error("Tải lên hoàn tất nhưng không nhận được URI file");

          // 3. Transcribe using File URI
          setStatusText(`Đang phân tích nội dung ${file.name}...`);
          const transcribeRes = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileUri,
              mimeType: distinctMimeType,
              apiKey,
              ...(modelName ? { modelName } : {})
            })
          });

          const data = await transcribeRes.json();
          if (!transcribeRes.ok) throw new Error(data.error || "Phiên dịch thất bại");
          responseText = data.text;

          // Cập nhật thông tin model đã dùng (lấy từ lần cuối cùng thành công)
          if (data.modelUsed) {
            setModelUsed(data.modelUsed);
            setWasFallback(!!data.wasFallback);
          }

        } catch (err: any) {
          console.error(err);
          throw new Error(`Xử lý thất bại: ${err.message}`);
        }

        // accumulate text
        if (accumulatedText) {
          accumulatedText += "\n\n---\n\n";
        }
        accumulatedText += responseText;

        // Update UI immediately
        setTranscribedText(accumulatedText);

        // RATE LIMITING (v2.2): Optimized for Paid Tier (0.5s delay)
        if (i < files.length - 1) {
          setStatusText(`Đang chờ (Tránh giới hạn tốc độ)...`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Auto-generate filename using AI
      if (accumulatedText.trim().length > 0) {
        setStatusText("Đang tạo tên file thông minh...");
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
          console.error("Tạo tiêu đề thất bại", e);
        }
      }

      setStatusText("Hoàn thành!");
    } catch (error: any) {
      console.error("Frontend process error:", error);
      alert("Lỗi: " + error.message);
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
      const fileName = suggestedFilename ? `${suggestedFilename}.docx` : "phien_am.docx";

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
      console.error("Lỗi tạo tài liệu:", error);
      alert("Không thể tạo tài liệu.");
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center font-sans" style={{ background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #0f0f1a 100%)" }}>

      {/* Top bar */}
      <div className="w-full border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div>
          <span className="text-lg font-bold text-white">Công cụ trích xuất văn bản</span>
          <span className="ml-2 text-xs bg-white/10 text-white/40 px-2 py-0.5 rounded-full"></span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          title="Cài đặt nâng cao"
          className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors ${showSettings ? "bg-blue-500/20 text-blue-300 border border-blue-400/30" : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"}`}
        >
          <Settings2 size={14} /> Cài đặt
        </button>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="w-full overflow-hidden border-b border-white/10 bg-white/3"
          >
            <div className="max-w-2xl mx-auto px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-white/50 mb-1.5 font-medium">Google Gemini API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Để trống để dùng key mặc định của server..."
                  className="w-full px-3 py-2 rounded-lg text-sm glass-input"
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1.5 font-medium">Tên Model AI <span className="text-white/30">(tuỳ chọn)</span></label>
                <input
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="Ví dụ: gemini-1.5-pro"
                  className="w-full px-3 py-2 rounded-lg text-sm glass-input"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="w-full max-w-2xl mx-auto px-5 py-8 flex flex-col gap-6">

        {/* Step 1: Upload */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
            <span className="text-sm font-semibold text-white/80">Chọn file cần trích xuất</span>
          </div>
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => document.getElementById("fileInput")?.click()}
            className="border-2 border-dashed border-blue-400/30 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all hover:border-blue-400/60 hover:bg-blue-400/5 active:scale-[0.99]"
          >
            <div className="w-14 h-14 rounded-xl bg-blue-500/15 border border-blue-400/20 flex items-center justify-center mb-3">
              <Upload size={28} className="text-blue-400" />
            </div>
            <p className="font-semibold text-white text-base">Nhấn vào đây để chọn file</p>
            <p className="text-white/40 text-sm mt-1">hoặc kéo thả file vào đây</p>
            <div className="flex gap-2 mt-4">
              {["📄 PDF", "🖼 JPG", "🖼 PNG"].map(t => (
                <span key={t} className="text-xs bg-white/8 text-white/50 px-3 py-1 rounded-full border border-white/10">{t}</span>
              ))}
            </div>
            <input id="fileInput" type="file" multiple className="hidden" accept="image/*,application/pdf" onChange={handleFileSelect} />
          </div>
        </div>

        {/* File list */}
        <AnimatePresence>
          {files.length > 0 && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-purple-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">✓</span>
                <span className="text-sm font-semibold text-white/80">File đã chọn</span>
                <span className="ml-auto text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-400/30">{files.length} file</span>
              </div>
              <div className="rounded-2xl border border-white/10 overflow-hidden divide-y divide-white/5">
                {files.map((file, index) => (
                  <motion.div
                    key={`${file.name}-${index}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex items-center gap-3 px-4 py-3 bg-white/3 hover:bg-white/6 transition-colors group"
                  >
                    <span className="text-xs text-white/30 w-5 text-center flex-shrink-0">{index + 1}</span>
                    <FileText size={14} className="text-purple-400 flex-shrink-0" />
                    <span className="text-sm text-white/70 truncate flex-1">{file.name}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button title="Lên" onClick={(e) => { e.stopPropagation(); moveFile(index, -1); }} disabled={index === 0} className="p-1 text-white/30 hover:text-blue-400 disabled:opacity-20 text-base leading-none">↑</button>
                      <button title="Xuống" onClick={(e) => { e.stopPropagation(); moveFile(index, 1); }} disabled={index === files.length - 1} className="p-1 text-white/30 hover:text-blue-400 disabled:opacity-20 text-base leading-none">↓</button>
                      <button title="Xoá" onClick={(e) => { e.stopPropagation(); removeFile(index); }} className="p-1 text-white/30 hover:text-red-400 ml-1">
                        <X size={14} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step 2: Big Action Button */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0 ${files.length > 0 ? "bg-blue-500" : "bg-white/20"}`}>2</span>
            <span className="text-sm font-semibold text-white/80">Bắt đầu trích xuất</span>
          </div>
          <button
            onClick={processFiles}
            disabled={isProcessing || files.length === 0}
            className={`w-full py-5 rounded-2xl font-bold text-xl flex items-center justify-center gap-3 transition-all select-none
              ${isProcessing
                ? "bg-blue-600/40 text-blue-200 cursor-not-allowed"
                : files.length === 0
                  ? "bg-white/8 text-white/25 cursor-not-allowed border-2 border-dashed border-white/15"
                  : "bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-xl shadow-purple-900/40 hover:shadow-purple-900/60 hover:scale-[1.01] active:scale-[0.99]"
              }`}
          >
            {isProcessing ? (
              <>
                <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
                <style jsx global>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                <span>{statusText || "Đang xử lý..."}</span>
              </>
            ) : files.length === 0 ? (
              <span className="text-base">← Hãy chọn file ở bước 1 trước</span>
            ) : (
              <>
                <Check size={24} />
                <span>Bắt đầu Phiên dịch ({files.length} file)</span>
              </>
            )}
          </button>
        </div>

        {/* Step 3: Result */}
        <AnimatePresence>
          {(transcribedText || isProcessing) && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                <span className="text-sm font-semibold text-white/80">Kết quả</span>
                {/* Badge model đang dùng */}
                {modelUsed && (
                  <span
                    title={wasFallback ? "Model dự phòng được dùng do server quá tải" : "Model chính đang hoạt động bình thường"}
                    className={`ml-1 text-xs px-2 py-0.5 rounded-full border font-mono flex items-center gap-1 cursor-default ${wasFallback
                      ? "bg-amber-500/15 text-amber-300 border-amber-400/30"
                      : "bg-green-500/15 text-green-300 border-green-400/30"
                      }`}
                  >
                    {wasFallback ? "⚠️" : "✓"} {modelUsed}
                  </span>
                )}
                {transcribedText && (
                  <button
                    onClick={downloadDocx}
                    className="ml-auto flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-300 rounded-xl hover:bg-green-500/30 font-semibold text-sm transition-colors border border-green-500/30"
                  >
                    <Download size={16} /> Lưu .docx
                  </button>
                )}
              </div>

              {/* Banner cảnh báo khi dùng model dự phòng */}
              {transcribedText && wasFallback && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-400/25 flex items-start gap-2.5"
                >
                  <span className="text-amber-400 text-base flex-shrink-0 mt-0.5">⚠️</span>
                  <div className="text-xs text-amber-200/80 leading-relaxed">
                    <span className="font-semibold text-amber-300">Server model chính bị quá tải</span> — Kết quả này được xử lý bằng{" "}
                    <span className="font-mono text-amber-200">{modelUsed}</span> (model dự phòng).{" "}
                    Chất lượng có thể thấp hơn so với model chính. Nếu kết quả chưa đúng ý, hãy thử lại sau vài phút.
                  </div>
                </motion.div>
              )}

              <div className="rounded-2xl border border-white/10 bg-black/30 p-5 min-h-[200px] max-h-[500px] overflow-y-auto font-mono text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
                {transcribedText || (
                  <div className="flex items-center gap-3 text-white/40 pt-4">
                    <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                    <span>{statusText || "Đang xử lý..."}</span>
                  </div>
                )}
              </div>
              {transcribedText && !isProcessing && (
                <p className="text-center text-xs text-white/30 mt-2">✅ Hoàn tất — Nhấn "Lưu .docx" để tải về</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>


        {/* FAQ nhỏ gọn */}
        <details className="group mt-2">
          <summary className="text-xs text-white/30 cursor-pointer hover:text-white/50 transition-colors select-none flex items-center gap-1">
            <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
            Câu hỏi thường gặp
          </summary>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-white/40">
            <div><span className="text-white/60 font-medium">File nào được hỗ trợ?</span><br />Hình ảnh JPG, PNG và file PDF.</div>
            <div><span className="text-white/60 font-medium">Mất bao lâu?</span><br />10–60 giây tuỳ kích thước file. Đừng đóng trang.</div>
            <div><span className="text-white/60 font-medium">File .docx là gì?</span><br />File Word, mở được bằng Microsoft Word hoặc Google Docs.</div>
            <div><span className="text-white/60 font-medium">Dữ liệu có bị lưu không?</span><br />Không. File chỉ gửi đến AI để đọc chữ, không lưu lại.</div>
          </div>
        </details>

      </div>
    </main>
  );
}
