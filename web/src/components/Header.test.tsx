import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

const CORE_OK = {
  postgres: { status: 'ok' },
  redis: { status: 'ok' },
  queue: { status: 'ok' },
};

function stubHealth(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
}

const LLM_OK = {
  status: 'ok',
  models: { chat: { name: 'llama3.2:3b', status: 'ok' }, vision: { name: 'qwen2.5vl:3b', status: 'ok' } },
};
const LLM_UNAVAILABLE = {
  status: 'unavailable',
  message: 'Ollama not reachable at http://host.docker.internal:11434',
  models: { chat: { name: 'llama3.2:3b', status: 'unknown' }, vision: { name: 'qwen2.5vl:3b', status: 'unknown' } },
};
const LLM_VISION_MISSING = {
  status: 'degraded',
  message: 'Model not pulled: qwen2.5vl:3b',
  models: { chat: { name: 'llama3.2:3b', status: 'ok' }, vision: { name: 'qwen2.5vl:3b', status: 'missing' } },
};

describe('Header health pill (CP-007)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows all systems operational when the core and the LLM are ok', async () => {
    stubHealth({ status: 'ok', subsystems: CORE_OK, llm: LLM_OK });
    render(<Header />);
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
  });

  it('shows LLM offline, and the ollama serve hint in the dropdown, when Ollama is unreachable', async () => {
    stubHealth({ status: 'ok', subsystems: CORE_OK, llm: LLM_UNAVAILABLE });
    render(<Header />);
    fireEvent.click(await screen.findByRole('button', { name: /LLM offline/ }));
    expect(screen.getByText('Local LLM')).toBeInTheDocument();
    expect(screen.getByText('ollama serve')).toBeInTheDocument();
  });

  it('shows LLM model missing, and a pull hint for the missing model only', async () => {
    stubHealth({ status: 'ok', subsystems: CORE_OK, llm: LLM_VISION_MISSING });
    render(<Header />);
    fireEvent.click(await screen.findByRole('button', { name: /LLM model missing/ }));
    expect(screen.getByText('ollama pull qwen2.5vl:3b')).toBeInTheDocument();
    expect(screen.queryByText('ollama pull llama3.2:3b')).not.toBeInTheDocument();
  });

  it('core degradation takes precedence over the LLM state', async () => {
    stubHealth({
      status: 'degraded',
      subsystems: { ...CORE_OK, postgres: { status: 'error', message: 'connection refused' } },
      llm: LLM_UNAVAILABLE,
    });
    render(<Header />);
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.queryByText('LLM offline')).not.toBeInTheDocument();
  });

  it('behaves as before when the API sends no llm key', async () => {
    stubHealth({ status: 'ok', subsystems: CORE_OK });
    render(<Header />);
    fireEvent.click(await screen.findByRole('button', { name: /All systems operational/ }));
    expect(screen.queryByText('Local LLM')).not.toBeInTheDocument();
  });
});
