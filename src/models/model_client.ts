export type ThinkingEffort = 'low' | 'medium' | 'high';

export type ModelPart =
  | { text: string }
  | { image: { data: Uint8Array; mimeType: string; resolution?: 'low' | 'medium' | 'high' } };

  /** Token counts reported by the model. */
export interface ModelTokenUsage {
  promptTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
}

  /** Parameters passed to the model. */
export interface ModelRequest {
  model: string;
  system?: string;
  parts: ModelPart[];
  jsonSchema: object;
  thinking?: ThinkingEffort;
  timeoutMs: number;
}

  /** Response from the model. */
export interface ModelResponse {
  text: string;
  usage?: ModelTokenUsage;
  blockReason?: string;
}
/** A function that receives a request and returns a response from the model (asynchronously). */
export type ModelClient = (req: ModelRequest) => Promise<ModelResponse>;