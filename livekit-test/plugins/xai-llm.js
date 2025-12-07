/**
 * Custom XAI (Grok) LLM Plugin for LiveKit Agents
 * Implements the LiveKit LLM interface using XAI's API
 */

import { EventEmitter } from 'events';

export class XAILLMPlugin extends EventEmitter {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.XAI_API_KEY;
    this.baseUrl = config.baseUrl || process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
    this.model = config.model || 'grok-3';
    this.temperature = config.temperature || 0.7;
    this.maxTokens = config.maxTokens || 1024;
  }

  /**
   * Generate a chat completion using XAI's API
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Additional options
   * @returns {Promise<string>} - The generated response
   */
  async chat(messages, options = {}) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        temperature: options.temperature || this.temperature,
        max_tokens: options.maxTokens || this.maxTokens,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`XAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  /**
   * Stream chat completion using XAI's API
   * @param {Array} messages - Array of message objects
   * @param {Object} options - Additional options
   * @returns {AsyncGenerator<string>} - Stream of text chunks
   */
  async *streamChat(messages, options = {}) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        temperature: options.temperature || this.temperature,
        max_tokens: options.maxTokens || this.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`XAI API error: ${response.status} - ${error}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Create a function calling completion
   * @param {Array} messages - Conversation messages
   * @param {Array} functions - Available functions
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Function call or text response
   */
  async chatWithFunctions(messages, functions, options = {}) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        functions: functions,
        temperature: options.temperature || this.temperature,
        max_tokens: options.maxTokens || this.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`XAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    if (choice.message.function_call) {
      return {
        type: 'function_call',
        name: choice.message.function_call.name,
        arguments: JSON.parse(choice.message.function_call.arguments),
      };
    }

    return {
      type: 'text',
      content: choice.message.content,
    };
  }
}

export default XAILLMPlugin;
