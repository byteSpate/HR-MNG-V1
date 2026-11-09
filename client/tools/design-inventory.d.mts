export interface SourceCounts {
  fontSizes: Record<string, number>
  hexColors: Record<string, number>
  iconSizes: Record<string, number>
  dialogWidths: Record<string, number>
  rawHeadings: number
  rawImg: number
}
export function countSource(src: string): SourceCounts
export function scan(root: string): { total: SourceCounts; perFile: Record<string, Record<string, Record<string, number>>> }
