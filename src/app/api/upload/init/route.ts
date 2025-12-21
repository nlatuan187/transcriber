
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { mimeType, displayName } = await req.json();
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return NextResponse.json({ error: "Server API Key not configured" }, { status: 500 });
        }

        // 1. Initiate Resumable Upload
        const initRes = await fetch(
            `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
            {
                method: "POST",
                headers: {
                    "X-Goog-Upload-Protocol": "resumable",
                    "X-Goog-Upload-Command": "start",
                    "X-Goog-Upload-Header-Content-Length": "",
                    "X-Goog-Upload-Header-Content-Type": mimeType,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    file: {
                        display_name: displayName,
                    },
                }),
            }
        );

        if (!initRes.ok) {
            const text = await initRes.text();
            throw new Error(`Failed to initiate upload: ${initRes.status} ${text}`);
        }

        const uploadUrl = initRes.headers.get("x-goog-upload-url");

        if (!uploadUrl) {
            throw new Error("No upload URL returned from Gemini");
        }

        return NextResponse.json({ uploadUrl });
    } catch (error: any) {
        console.error("Upload init error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to initiate upload" },
            { status: 500 }
        );
    }
}
