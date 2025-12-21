
import { NextRequest, NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/gemini";

export async function POST(req: NextRequest) {
    try {
        console.log("Server Env API Key present:", !!process.env.GEMINI_API_KEY);
        console.log("Server Env Model Name:", process.env.GEMINI_MODEL_NAME);

        let apiKey = process.env.GEMINI_API_KEY;
        let modelName = process.env.GEMINI_MODEL_NAME || "gemini-1.5-pro";
        let parts = [];

        // Check content type to distinguish between JSON (large file flow) and FormData (small file flow)
        const contentType = req.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
            // New Flow: Large File (File URI)
            const body = await req.json();
            const { fileUri, mimeType } = body;

            // Allow client to override params if needed (optional, implemented for consistency)
            if (body.apiKey) apiKey = body.apiKey;
            if (body.modelName) modelName = body.modelName;

            if (!fileUri) {
                return NextResponse.json({ error: "No fileUri provided" }, { status: 400 });
            }

            parts.push({
                fileData: {
                    mimeType: mimeType || "application/pdf",
                    fileUri: fileUri
                }
            });

        } else {
            // Old Flow: FormData (Small File)
            const formData = await req.formData();

            // Prioritize environment variable for API Key for security, fallback to form data.
            apiKey = apiKey || (formData.get("apiKey") as string);
            modelName = (formData.get("modelName") as string) || modelName;

            const files = formData.getAll("files") as File[]; // Expect inputs named 'files'

            if (!apiKey) {
                return NextResponse.json({ error: "API Key is required" }, { status: 400 });
            }

            if (!files || files.length === 0) {
                return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
            }

            // Process files in order (First-In-First-Out)
            for (const file of files) {
                const arrayBuffer = await file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                parts.push({
                    inlineData: {
                        data: buffer.toString("base64"),
                        mimeType: file.type,
                    },
                });
            }
        }

        if (!apiKey) {
            return NextResponse.json({ error: "API Key is required" }, { status: 400 });
        }

        const model = getGeminiModel(apiKey, modelName);

        const prompt = `
    Vai trò: Bạn là một chuyên gia Chuyển đổi văn bản y tế (Medical Transcriber) am hiểu sâu sắc về cả Đông Y và Tây Y.
    
    Nhiệm vụ: Trích xuất toàn bộ văn bản từ hình ảnh/tài liệu này.
    
    Yêu cầu ĐẶC BIỆT (Context Y Học):
    1. Tài liệu chứa nhiều thuật ngữ chuyên ngành Y học (Đông Y/Tây Y), các ký hiệu hóa học, sinh học, và tên thuốc.
    2. Hãy chú ý đặc biệt đến các từ ngữ khó, chữ viết tay, hoặc các ký hiệu viết tắt trong đơn thuốc/sách y.
    3. Ưu tiên nhận diện đúng các thuật ngữ y khoa nếu chữ bị mờ.
    
    Yêu cầu TUYỆT ĐỐI về định dạng:
    1. "Có gì viết nấy": Chỉ trả về nội dung văn bản. KHÔNG thêm bất kỳ lời dẫn, giải thích, hay nhận xét nào (ví dụ: "Đây là...", "Văn bản gồm...").
    2. Giữ nguyên định dạng xuống dòng (paragraph breaks).
    3. Không dùng markdown code blocks (\`\`\`).
    4. Nếu ảnh trắng/không có chữ, trả về khoảng trắng.
    `;

        const result = await model.generateContent([prompt, ...parts]);
        const response = await result.response;
        const text = response.text();

        return NextResponse.json({ text });
    } catch (error: any) {
        console.error("Transcription error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to process request" },
            { status: 500 }
        );
    }
}
