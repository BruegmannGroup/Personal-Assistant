"""Pluggable LLM client used by every script in this repo (transcribe_and_extract.py,
momentum_review.py, pre_meeting.py). Adding a new provider means adding one class here
— nothing else in the repo needs to change.

Select a provider with the LLM_PROVIDER env var (gemini | openai | anthropic), or
override per call. Each provider reads its own API key from the environment:
  - gemini:    GEMINI_API_KEY    (https://aistudio.google.com/apikey)
  - openai:    OPENAI_API_KEY    (https://platform.openai.com/api-keys)
  - anthropic: ANTHROPIC_API_KEY (https://console.anthropic.com/settings/keys)
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod

from dotenv import load_dotenv

load_dotenv()


class LLMProvider(ABC):
    name: str
    default_model: str

    @abstractmethod
    def generate(
        self,
        system_prompt: str,
        user_content: str,
        model_name: str,
        temperature: float,
        max_output_tokens: int,
    ) -> str:
        """Return the model's raw text response. Callers are responsible for
        extracting/parsing JSON out of it (see try_parse_json_from_text-style
        helpers) — providers should request native JSON mode where available,
        but must not assume the caller only ever wants JSON."""


class GeminiProvider(LLMProvider):
    name = "gemini"
    default_model = "gemini-3.5-flash-lite"

    def generate(self, system_prompt, user_content, model_name, temperature, max_output_tokens) -> str:
        try:
            from google import genai
            from google.genai import types
        except ImportError:
            raise RuntimeError("google-genai package not available; pip install google-genai")
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY not set in environment or .env")

        client = genai.Client(api_key=key)
        response = client.models.generate_content(
            model=model_name,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
                response_mime_type="application/json",
            ),
        )
        return response.text


class OpenAIProvider(LLMProvider):
    name = "openai"
    default_model = "gpt-4o"

    def generate(self, system_prompt, user_content, model_name, temperature, max_output_tokens) -> str:
        try:
            from openai import OpenAI
        except ImportError:
            raise RuntimeError("openai package not available; pip install openai")
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY not set in environment or .env")

        client = OpenAI(api_key=key)
        completion = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=temperature,
            max_tokens=max_output_tokens,
            response_format={"type": "json_object"},
        )
        return completion.choices[0].message.content


class AnthropicProvider(LLMProvider):
    name = "anthropic"
    default_model = "claude-sonnet-5"

    def generate(self, system_prompt, user_content, model_name, temperature, max_output_tokens) -> str:
        try:
            from anthropic import Anthropic
        except ImportError:
            raise RuntimeError("anthropic package not available; pip install anthropic")
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set in environment or .env")

        # No native JSON mode on the Messages API — the shared instruction text
        # already tells the model to return a bare JSON object, and callers
        # already extract JSON out of arbitrary surrounding text defensively.
        client = Anthropic(api_key=key)
        message = client.messages.create(
            model=model_name,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
            temperature=temperature,
            max_tokens=max_output_tokens,
        )
        return "".join(block.text for block in message.content if block.type == "text")


_PROVIDERS: dict[str, LLMProvider] = {
    "gemini": GeminiProvider(),
    "openai": OpenAIProvider(),
    "anthropic": AnthropicProvider(),
}


def get_provider(name: str | None = None) -> LLMProvider:
    name = (name or os.environ.get("LLM_PROVIDER") or "gemini").lower()
    if name not in _PROVIDERS:
        raise ValueError(f"Unknown LLM provider '{name}'. Choices: {', '.join(_PROVIDERS)}")
    return _PROVIDERS[name]


def call_llm(
    system_prompt: str,
    user_content: str,
    provider: str | None = None,
    model_name: str | None = None,
    temperature: float = 0.0,
    max_output_tokens: int = 8000,
) -> str:
    """Provider-agnostic entry point. Pass provider/model_name to override the
    LLM_PROVIDER env var and that provider's default model for this one call."""
    impl = get_provider(provider)
    return impl.generate(
        system_prompt=system_prompt,
        user_content=user_content,
        model_name=model_name or impl.default_model,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )
