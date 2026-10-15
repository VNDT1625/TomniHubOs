import type { TrendingRepo } from './types';
/** Curated repository examples, not a real-time trending rank. */
export const getTrendingRepos = (): TrendingRepo[] => [
  {
    name: 'facebook/react',
    url: 'https://github.com/facebook/react',
    description: 'React user interfaces',
    language: 'JavaScript',
  },
  {
    name: 'microsoft/TypeScript',
    url: 'https://github.com/microsoft/TypeScript',
    description: 'TypeScript language',
    language: 'TypeScript',
  },
  {
    name: 'astral-sh/uv',
    url: 'https://github.com/astral-sh/uv',
    description: 'Python package manager',
    language: 'Rust',
  },
  {
    name: 'ollama/ollama',
    url: 'https://github.com/ollama/ollama',
    description: 'Local model runtime',
    language: 'Go',
  },
  {
    name: 'vllm-project/vllm',
    url: 'https://github.com/vllm-project/vllm',
    description: 'LLM inference engine',
    language: 'Python',
  },
];
