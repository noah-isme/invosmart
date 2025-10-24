import { vi } from "vitest";

class MockChatCompletions {
  create = vi.fn();
}

class MockChat {
  completions = new MockChatCompletions();
}

class MockOpenAI {
  chat = new MockChat();
}

export default MockOpenAI;
