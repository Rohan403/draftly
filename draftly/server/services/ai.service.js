const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const TONE_INSTRUCTIONS = {
  formal: `
- Use formal, polished language with complete sentences
- Avoid contractions (use "I will" not "I'll", "do not" not "don't")
- Begin with a proper salutation (e.g., "Dear [Name],")
- End with a formal closing (e.g., "Yours sincerely," or "Kind regards,")
- Maintain a respectful, authoritative tone throughout`.trim(),

  friendly: `
- Use warm, approachable language as if writing to a colleague you know well
- Contractions are encouraged (e.g., "I'll", "we're", "that's")
- Begin with a casual but pleasant greeting (e.g., "Hi [Name]," or "Hey [Name],")
- End with an upbeat closing (e.g., "Thanks!", "Cheers," or "Talk soon,")
- Keep the energy positive and conversational`.trim(),

  concise: `
- Be extremely brief — aim for 3–5 sentences maximum
- Address only the core points; skip pleasantries
- Use short, direct sentences with no filler words
- A one-line greeting and one-line sign-off is sufficient
- Every sentence must add information; cut anything that doesn't`.trim(),

  professional: `
- Use clear, business-appropriate language
- Contractions are acceptable; keep the register neutral-to-formal
- Begin with a standard greeting (e.g., "Hi [Name]," or "Hello [Name],")
- End with a standard closing (e.g., "Best regards," or "Thanks,")
- Balance brevity with completeness — cover all points without being verbose`.trim(),

  casual: `
- Write as you would to a friend or close teammate
- Use everyday conversational language; slang is fine if natural
- Short sentences and informal structure are preferred
- Greeting and sign-off can be very relaxed (e.g., "Hey!", "Later," or just your name)
- The reply should feel effortless and genuine, not corporate`.trim(),
};

function buildPrompt({ emailBody, threadContext, styleSamples, senderName, tone = 'professional' }) {
  const toneInstructions = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.professional;

  const styleSection = styleSamples.length
    ? `Here are examples of how ${senderName} writes emails. Use these to match their vocabulary, sentence rhythm, and natural phrasing — but override their style where needed to honour the requested tone.\n\n${styleSamples
        .slice(0, 15)
        .map((s, i) => `--- Example ${i + 1} ---\n${s}`)
        .join('\n\n')}\n\n`
    : '';

  const threadSection = threadContext.length
    ? `--- Thread History (earliest → most recent) ---\n${threadContext
        .map((msg, i) => `[Message ${i + 1}]\n${msg}`)
        .join('\n\n')}\n\n`
    : '';

  return `You are an AI email assistant writing a reply on behalf of ${senderName}.

TONE: ${tone.toUpperCase()}
Tone rules for this reply:
${toneInstructions}

${styleSection}${threadSection}--- Email to Reply To ---
${emailBody}

--- Instructions ---
Write a reply that:
- Follows the tone rules above exactly
- Addresses every point raised in the email
- Matches ${senderName}'s natural vocabulary from the examples (where it doesn't conflict with the tone)
- Does NOT include a subject line — body text only
- Ends with an appropriate sign-off consistent with the tone

Reply:`;
}

async function generateDraft({ emailBody, threadContext, styleSamples, senderName, tone = 'professional' }) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = buildPrompt({ emailBody, threadContext, styleSamples, senderName, tone });

  const result = await model.generateContent(prompt);
  const response = result.response;

  return {
    bodyText: response.text().trim(),
    model: 'gemini-1.5-flash',
    promptTokens: response.usageMetadata?.promptTokenCount || 0,
    completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
  };
}

module.exports = { generateDraft, SUPPORTED_TONES: Object.keys(TONE_INSTRUCTIONS) };
