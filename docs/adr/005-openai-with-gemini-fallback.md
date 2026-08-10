# 5. OpenAI with Gemini Fallback

## Status
Accepted

## Context
AI is a core pillar of the InvoSmart platform, powering critical features such as automated invoice generation, OCR receipt scanning, UI theme suggestions, and optimization explanations. We need an AI pipeline that balances extremely high quality, cost-effectiveness, and maximum uptime.

## Decision
We will use **OpenAI GPT-4o-mini** as our primary AI model, with **Google Gemini** configured as a fallback.

## Consequences
### Positive
*   **Quality & Capability**: OpenAI models currently provide best-in-class reasoning and formatting capabilities, crucial for structured outputs like invoice generation.
*   **Cost Efficiency**: Utilizing the "mini" variant significantly reduces inference costs while maintaining sufficient capability for our use cases.
*   **High Availability**: Configuring Gemini as an automatic fallback ensures our AI features remain functional even during OpenAI service degradations or outages.

### Negative / Trade-offs
*   **Implementation Complexity**: Maintaining integrations, prompt structures, and response parsing for two distinct LLM providers.
*   **Inconsistent Outputs**: Minor variations in tone or formatting might occur when the system falls back to Gemini.
