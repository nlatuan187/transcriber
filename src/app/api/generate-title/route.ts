
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
    try {
        const { text, apiKey } = await req.json();

        if (!text) {
            return NextResponse.json({ error: "No text provided" }, { status: 400 });
        }

        // Use environment API Key if client doesn't provide one
        const finalApiKey = process.env.GEMINI_API_KEY || apiKey;

        if (!finalApiKey) {
            return NextResponse.json({ error: "API Key required" }, { status: 400 });
        }

        const genAI = new GoogleGenerativeAI(finalApiKey);
        // Use Flash for speed and cost effectiveness
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
      Nhiệm vụ: Đặt một tên file ngắn gọn (file name) cho đoạn văn bản dưới đây.
      
      Yêu cầu:
      1. Tóm tắt nội dung chính trong tối đa 5-7 từ.
      2. Tiếng Việt không dấu hoặc có dấu đều được, nhưng ưu tiên không dấu để tránh lỗi hệ thống (ví dụ: "Benh_An_Nguyen_Van_A").
      3. Sử dụng dấu gạch dưới (_) để nối các từ.
      4. KHÔNG thêm đuôi file (.docx, .pdf).
      5. Chỉ trả về duy nhất chuỗi tên file. Không giải thích.
      
      Văn bản:
      "${text.substring(0, 2000)}"
    `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const title = response.text().trim().replace(/[^a-zA-Z0-9_\u00C0-\u00FF ]/g, "").replace(/\s+/g, "_");

        return NextResponse.json({ title });
    } catch (error: any) {
        console.error("Title generation error:", error);
        return NextResponse.json({ title: "transcription" }); // Fallback
    }
}
