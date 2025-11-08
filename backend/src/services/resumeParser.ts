import mammoth from 'mammoth'
import { fileTypeFromBuffer } from 'file-type'

export interface ParsedResume { text: string, format: string }

export async function parseResume (buffer: Buffer): Promise<ParsedResume> {
  const ft = await fileTypeFromBuffer(buffer).catch(() => null)
  // Try PDF
  if (ft?.mime === 'application/pdf') {
    try {
      const pdfParse = (await import('pdf-parse')).default
      const data = await pdfParse(buffer)
      return { text: data.text, format: 'pdf' }
    } catch (error) {
      console.error('PDF parsing failed:', error)
      return { text: buffer.toString('utf8'), format: 'pdf-fallback' }
    }
  }
  // DOCX
  if (ft?.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { value } = await mammoth.extractRawText({ buffer })
    return { text: value, format: 'docx' }
  }
  // Plain text fallback
  return { text: buffer.toString('utf8'), format: ft?.mime || 'text/plain' }
}
