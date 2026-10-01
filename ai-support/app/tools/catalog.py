from __future__ import annotations

import httpx
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

async def search_catalog(client: httpx.AsyncClient, params: Dict[str, Any], headers: Dict[str, str]) -> str:
    """
    Search catalog products and return a human-readable summary.
    """
    try:
        response = await client.get("/api/catalog/products", params=params, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        items = data.get("items", [])
        if not items:
            return "No products found matching the search."
            
        summary = "Found the following products:\n"
        for item in items:
            summary += f"- {item.get('name')} (Code: {item.get('partnerCode')}) - Price: {item.get('displayPrice')}\n"
            
        return summary
    except Exception as e:
        logger.error(f"Error in search_catalog: {e}")
        return f"Error searching catalog: {str(e)}"

async def get_product_details(client: httpx.AsyncClient, params: Dict[str, Any], headers: Dict[str, str]) -> str:
    """
    Get product details by code and return a summary.
    """
    code = params.get("code")
    if not code:
        return "Product code is required."
        
    try:
        response = await client.get(f"/api/catalog/products/{code}", headers=headers)
        response.raise_for_status()
        item = response.json()
        
        summary = f"Product Details for {item.get('name')}:\n"
        summary += f"Code: {item.get('partnerCode')}\n"
        summary += f"Description: {item.get('description')}\n"
        summary += f"Price: {item.get('displayPrice')} (Discounted: {item.get('discountedPrice')})\n"
        summary += f"Sample Type: {item.get('sampleType')}\n"
        
        return summary
    except Exception as e:
        logger.error(f"Error in get_product_details: {e}")
        return f"Error getting product details: {str(e)}"
