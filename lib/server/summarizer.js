function parseJsonPayload(text) {
  if (!text) {
    return null;
  }

  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function normalizeSummary(summary) {
  return {
    short: summary?.short || "Summary unavailable.",
    keyPoints: Array.isArray(summary?.keyPoints) ? summary.keyPoints : [],
    decisions: Array.isArray(summary?.decisions) ? summary.decisions : [],
    actionItems: Array.isArray(summary?.actionItems) ? summary.actionItems : [],
    openQuestions: Array.isArray(summary?.openQuestions) ? summary.openQuestions : [],
    participants: Array.isArray(summary?.participants) ? summary.participants : []
  };
}

function localFallbackSummary(transcript) {
  const lines = transcript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const short = lines.slice(0, 4).join(" ").slice(0, 600) || "No transcript content available.";

  const actionItems = lines
    .filter((line) => /action|todo|follow up|owner|deadline|next step/i.test(line))
    .slice(0, 8);

  const decisions = lines.filter((line) => /decide|agreed|approved|final/i.test(line)).slice(0, 6);

  const openQuestions = lines.filter((line) => /\?$/.test(line)).slice(0, 6);

  return normalizeSummary({
    short,
    keyPoints: lines.slice(0, 8),
    decisions,
    actionItems,
    openQuestions,
    participants: []
  });
}

function buildPrompt(transcript) {
  return `You are a meeting analyst. Read the transcript and return strict JSON with this shape:
{
  "short": "2-4 sentence summary",
  "keyPoints": ["..."],
  "decisions": ["..."],
  "actionItems": ["owner + action + due if known"],
  "openQuestions": ["..."],
  "participants": ["names only if explicitly detectable"]
}

Rules:
- Keep arrays concise and non-empty when evidence exists.
- Never invent facts.
- Output JSON only.

Transcript:
${transcript}`;
}

async function summarizeWithGemini(transcript, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: buildPrompt(transcript) }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1200
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n");
  const parsed = parseJsonPayload(text);

  if (!parsed) {
    throw new Error("Gemini returned non-JSON payload.");
  }

  return normalizeSummary(parsed);
}

async function summarizeWithOpenAI(transcript, apiKey) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: buildPrompt(transcript),
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data?.output_text || "";
  const parsed = parseJsonPayload(text);

  if (!parsed) {
    throw new Error("OpenAI returned non-JSON payload.");
  }

  return normalizeSummary(parsed);
}

import { getConfig } from "@/lib/server/config";

export async function summarizeTranscript(transcript) {
  const cleaned = (transcript || "").trim();

  if (!cleaned) {
    return localFallbackSummary("");
  }

  const config = getConfig();

  if (config.geminiApiKey) {
    try {
      return await summarizeWithGemini(cleaned, config.geminiApiKey);
    } catch {
      // Fall through to other providers/fallback.
    }
  }

  if (config.openaiApiKey) {
    try {
      return await summarizeWithOpenAI(cleaned, config.openaiApiKey);
    } catch {
      // Fall through to local fallback.
    }
  }

  return localFallbackSummary(cleaned);
}