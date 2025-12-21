import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const chunk = formData.get("chunk") as Blob;
        const uploadUrl = formData.get("uploadUrl") as string;
        const offset = formData.get("offset") as string;
        const totalSize = formData.get("totalSize") as string;

        if (!chunk || !uploadUrl || !offset || !totalSize) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const start = parseInt(offset);
        const end = start + chunk.size - 1; // Inclusive end byte
        const isLastChunk = end === parseInt(totalSize) - 1;

        // Convert chunk to ArrayBuffer for fetch
        const arrayBuffer = await chunk.arrayBuffer();

        console.log(`Proxying chunk: ${start}-${end}/${totalSize} to Gemini...`);

        const geminiRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Length": chunk.size.toString(),
                "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            },
            body: arrayBuffer,
        });

        // Gemini returns 308 Resume Incomplete for active uploads, 200/201 for finished
        if (geminiRes.status === 308) {
            return NextResponse.json({ status: "active" });
        } else if (geminiRes.status >= 200 && geminiRes.status < 300) {
            const data = await geminiRes.json();
            return NextResponse.json({ status: "finalized", file: data.file });
        } else {
            const text = await geminiRes.text();
            console.error("Gemini Upload Error:", geminiRes.status, text);
            return NextResponse.json({ error: `Gemini Error: ${text}` }, { status: geminiRes.status });
        }

    } catch (error: any) {
        console.error("Proxy Upload Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
