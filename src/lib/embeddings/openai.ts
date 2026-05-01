export type EmbeddingAdapter = {
  embed(texts: string[]): Promise<number[][]>;
  modelVersion: string;
  dimensions: number;
};

type OpenAiEmbeddingResponse = {
  data?: Array<{
    index: number;
    embedding: number[];
  }>;
  error?: {
    message?: string;
  };
};

const OPENAI_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

async function embedOpenAi(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const model = process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: texts }),
  });

  const bodyText = await response.text();
  let body: OpenAiEmbeddingResponse = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText) as OpenAiEmbeddingResponse;
    } catch {
      body = { error: { message: bodyText } };
    }
  }

  if (!response.ok) {
    throw new Error(
      `OpenAI embeddings failed (${response.status}): ${
        body.error?.message ?? bodyText
      }`
    );
  }

  const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
  if (data.length !== texts.length) {
    throw new Error(
      `OpenAI embeddings returned ${data.length} vectors for ${texts.length} inputs`
    );
  }

  return data.map((item) => {
    if (item.embedding.length !== OPENAI_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `OpenAI embeddings returned ${item.embedding.length} dimensions`
      );
    }
    return item.embedding;
  });
}

export function getEmbeddingAdapter(): EmbeddingAdapter {
  const provider = process.env.EMBEDDING_PROVIDER ?? "openai";
  if (provider !== "openai") {
    throw new Error(`Unsupported EMBEDDING_PROVIDER: ${provider}`);
  }

  const model = process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  return {
    embed: embedOpenAi,
    modelVersion: `openai/${model}`,
    dimensions: OPENAI_EMBEDDING_DIMENSIONS,
  };
}
