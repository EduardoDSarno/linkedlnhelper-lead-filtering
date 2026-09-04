export type ThinkingEffort = 'low' | 'medium' | 'high';

/** Image token/detail scale shared by every provider adapter. */
export type ImageResolution = 'low' | 'medium' | 'high';

/** Used when a caller omits thinking; matches both current call sites. */
export const DEFAULT_THINKING_EFFORT: ThinkingEffort = 'medium';

/** Used when an image part omits resolution; matches the image-stage default. */
export const DEFAULT_IMAGE_RESOLUTION: ImageResolution = 'medium';

/** Transient HTTP statuses both adapters treat as worth another transport try. */
export const MODEL_RETRY_HTTP_STATUS_CODES = [
  408,
  429,
  500,
  502,
  503,
  504,
] as const;

export type ModelPart =
  | { text: string }
  | { image: { data: Uint8Array; mimeType: string; resolution?: ImageResolution } };

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