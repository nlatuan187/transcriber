
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { mimeType, displayName } = await req.json();
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return NextResponse.json({ error: "API Key của server chưa được cấu hình" }, { status: 500 });
        }

        // 1. Khởi tạo Tải lên Có thể Tiếp tục
        const origin = req.headers.get("origin") || ""; // Quan trọng cho CORS

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
                    "Origin": origin, // <--- SỬa chính: Truyền Origin để Google biết ai sẽ tải lên
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
            throw new Error(`Khởi tạo tải lên thất bại: ${initRes.status} ${text}`);
        }

        const uploadUrl = initRes.headers.get("x-goog-upload-url");

        if (!uploadUrl) {
            throw new Error("Gemini không trả về URL tải lên");
        }

        return NextResponse.json({ uploadUrl });
    } catch (error: any) {
        console.error("Lỗi khởi tạo tải lên:", error);
        return NextResponse.json(
            { error: error.message || "Khởi tạo tải lên thất bại" },
            { status: 500 }
        );
    }
}
