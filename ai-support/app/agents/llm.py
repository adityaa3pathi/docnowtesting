from __future__ import annotations

import logging
from typing import Any, Optional
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

async def call_gemini(
    prompt: str, 
    settings: Any, 
    system_prompt: Optional[str] = None, 
    temperature: float = 0.7, 
    response_mime_type: Optional[str] = None
) -> str:
    """
    Calls the Gemini API.
    """
    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        
        config_kwargs = {
            "temperature": temperature,
        }
        
        if system_prompt:
            config_kwargs["system_instruction"] = system_prompt
            
        if response_mime_type:
            config_kwargs["response_mime_type"] = response_mime_type
            
        config = types.GenerateContentConfig(**config_kwargs)
        
        if hasattr(client, "aio"):
            response = await client.aio.models.generate_content(
                model=settings.llm_model,
                contents=prompt,
                config=config
            )
        else:
            response = client.models.generate_content(
                model=settings.llm_model,
                contents=prompt,
                config=config
            )
            
        return response.text
    except Exception as e:
        logger.error(f"Error calling Gemini API: {e}")
        raise e
