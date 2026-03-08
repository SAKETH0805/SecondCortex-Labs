#!/usr/bin/env python3
"""
SecondCortex MCP Server

Exposes the SecondCortex "Cortex Memory" (ChromaDB semantic search) as a tool
via the Model Context Protocol (MCP), so it can be queried by AI assistants like Claude Desktop or Cursor.
"""

import sys
import os
import asyncio
import logging

# Ensure the backend directory is in the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from services.vector_db import VectorDBService

# Initialize logging for MCP server
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("secondcortex.mcp")

# Initialize the VectorDB service
logger.info("Initializing VectorDBService for MCP...")
vector_db = VectorDBService()

# Create the MCP Server, allowing the Azure Production Host
mcp = FastMCP(
    "SecondCortex API",
    transport_security=TransportSecuritySettings(
        allowed_hosts=["sc-backend-suhaan.azurewebsites.net", "localhost", "127.0.0.1"]
    )
)

@mcp.tool()
async def search_memory(query: str, top_k: int = 5, user_id: str | None = None) -> str:
    """
    Search the developer's SecondCortex memory (IDE history snapshots) for relevant technical context.
    
    Args:
        query: The semantic search query (e.g., "authentication logic", "database schema changes")
        top_k: Number of relevant snapshots to retrieve (default: 5)
        user_id: Optional user ID to isolate search. If not provided, default backend user is used.
    
    Returns:
        A formatted summary string containing the best matching historical IDE snapshots.
    """
    logger.info(f"MCP search_memory called with query: '{query}'")
    
    results = await vector_db.semantic_search(query, top_k=top_k, user_id=user_id)
    
    if not results:
        return f"No relevant cortex memory found for query: '{query}'"
    
    # Format the results into a readable string for the LLM
    output_parts = [f"Found {len(results)} relevant snapshots for '{query}':\n"]
    
    for i, meta in enumerate(results):
        timestamp = meta.get("timestamp", "Unknown Time")
        file_path = meta.get("active_file", "Unknown File")
        branch = meta.get("git_branch", "Unknown Branch")
        summary = meta.get("summary", "No summary")
        
        chunk = (
            f"--- Snapshot {i+1} ---\n"
            f"Time: {timestamp}\n"
            f"File: {file_path}\n"
            f"Branch: {branch}\n"
            f"Summary: {summary}\n"
            f"Entities: {meta.get('entities', 'None')}\n"
        )
        
        # Include shadow graph (code context) if available
        # Note: 'document' might be populated if we used a method that fetched documents, 
        # but semantic_search currently returns dicts from metadata. 
        # We can include what's available. `shadow_graph` is stored in metadata up to 5000 chars.
        code_context = meta.get("shadow_graph")
        if code_context:
            # truncate code slightly for MCP to avoid exploding context windows unnecessarily
            code_snippet = code_context[:1000] + ("..." if len(code_context) > 1000 else "")
            chunk += f"Code Context:\n```\n{code_snippet}\n```\n"
            
        output_parts.append(chunk)
        
    return "\n".join(output_parts)

if __name__ == "__main__":
    logger.info("Starting SecondCortex MCP Server via stdio...")
    mcp.run()
