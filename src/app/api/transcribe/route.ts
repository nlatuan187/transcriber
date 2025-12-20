
import { NextRequest, NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/gemini";

export async function POST(req: NextRequest) {
    try {
        console.log("Server Env API Key present:", !!process.env.GEMINI_API_KEY);
        console.log("Server Env Model Name:", process.env.GEMINI_MODEL_NAME);

        const formData = await req.formData();
        // Prioritize environment variable for API Key for security, fallback to form data.
        // If running in a secure environment (e.g. Vercel), the env var is preferred.
        const apiKey = process.env.GEMINI_API_KEY || (formData.get("apiKey") as string);
        // Prioritize form data for Model to allow UI override, fallback to env var, then default
        const modelName = (formData.get("modelName") as string) || process.env.GEMINI_MODEL_NAME || "gemini-1.5-pro";
        const files = formData.getAll("files") as File[]; // Expect inputs named 'files'

        if (!apiKey) {
            return NextResponse.json({ error: "API Key is required (configured in .env or settings)" }, { status: 400 });
        }

        if (!files || files.length === 0) {
            return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
        }

        const model = getGeminiModel(apiKey, modelName);

        const parts = [];

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

        // Add prompt as the last part, or first - Gemini is flexible, but text text usually accompanies images.
        // The SDK allows passing strict [ ...images, text ]

        // Note: for very large PDFs, we should technically use the File API (uploadFile), 
        // but for this prototype, we'll try inline data first (limit ~20MB).
        // If files are large, this might fail, but it's a good V1.

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
