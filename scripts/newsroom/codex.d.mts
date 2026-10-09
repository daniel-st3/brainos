export function codexJSON(input: {
  prompt: string;
  schema: unknown;
  directory: string;
  name: string;
  images?: string[];
}): Promise<{ value: unknown; metrics: Record<string, unknown> }>;
