"""
Vector Database Service — handles connections to:
  1. LLM (GitHub Models or Azure OpenAI) for embeddings
  2. ChromaDB (vector storage & semantic search)
"""

from __future__ import annotations

import logging
from typing import Any

import chromadb
from chromadb.config import Settings

from config import settings
from services.llm_client import create_llm_client, get_embedding_model

logger = logging.getLogger("secondcortex.vectordb")


class VectorDBService:
    """Manages LLM embeddings and ChromaDB operations."""

    def __init__(self) -> None:
        self.openai_client = create_llm_client()

        # Initialize ChromaDB client (persistent)
        try:
            self.chroma_client = chromadb.PersistentClient(path="./chroma_db")
            self.collection = self.chroma_client.get_or_create_collection(
                name="secondcortex-snapshots"
            )
            logger.info("ChromaDB initialized.")
        except Exception as exc:
            logger.error("ChromaDB initialization failed: %s", exc)
            self.collection = None

    # ── Embeddings ──────────────────────────────────────────────

    async def generate_embedding(self, text: str) -> list[float]:
        """Generate a text embedding using the configured LLM provider."""
        try:
            response = self.openai_client.embeddings.create(
                model=get_embedding_model(),
                input=text[:8000],  # Truncate to avoid token limits
            )
            return response.data[0].embedding
        except Exception as exc:
            logger.error("Embedding generation failed: %s", exc)
            return []

    # ── Vector DB Operations ────────────────────────────────────

    async def upsert_snapshot(self, snapshot: Any) -> None:
        """Store a snapshot document (with embedding) in ChromaDB."""
        if self.collection is None:
            logger.warning("Chroma collection not available — skipping upsert.")
            return

        try:
            # ChromaDB metadatas support str, int, bool, float
            metadata = {
                "id": str(snapshot.id),
                "timestamp": snapshot.timestamp.isoformat() if hasattr(snapshot.timestamp, 'isoformat') else str(snapshot.timestamp),
                "workspace_folder": str(snapshot.workspace_folder or ""),
                "active_file": str(snapshot.active_file or ""),
                "language_id": str(snapshot.language_id or ""),
                "shadow_graph": str((snapshot.shadow_graph or "")[:5000]),
                "git_branch": str(snapshot.git_branch or ""),
                "summary": str(snapshot.metadata.summary if snapshot.metadata else ""),
                "entities": ",".join(snapshot.metadata.entities) if snapshot.metadata and snapshot.metadata.entities else "",
            }

            self.collection.add(
                ids=[str(snapshot.id)],
                embeddings=[snapshot.embedding or []],
                metadatas=[metadata],
                documents=[str(snapshot.shadow_graph or "")]
            )
            logger.info("Upserted snapshot %s to ChromaDB.", snapshot.id)
        except Exception as exc:
            logger.error("Upsert to ChromaDB failed: %s", exc)

    async def semantic_search(self, query: str, top_k: int = 5) -> list[dict]:
        """Perform a vector semantic search over stored snapshots."""
        if self.collection is None:
            logger.warning("Chroma collection not available — returning empty results.")
            return []

        try:
            # Generate embedding for the query
            query_embedding = await self.generate_embedding(query)

            if not query_embedding:
                logger.warning("No query embedding generated.")
                return []

            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k
            )

            # ChromaDB returns a dict of lists of lists. We only queried 1 embedding, so index 0
            if results and results.get("metadatas") and results["metadatas"]:
                metadatas_list = results["metadatas"][0]
                if metadatas_list is not None:
                    return [dict(meta) for meta in metadatas_list]

            return []

        except Exception as exc:
            logger.error("Semantic search failed: %s", exc)
            return []
