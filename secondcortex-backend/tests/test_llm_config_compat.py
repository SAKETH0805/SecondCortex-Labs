from __future__ import annotations

from config import Settings


def test_legacy_env_aliases_are_still_accepted(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "github_models")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://legacy-resource.openai.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "legacy-embed-deployment")

    cfg = Settings(_env_file=None)

    assert cfg.llm_provider_default == "github_models"
    assert cfg.azure_openai_base_url == "https://legacy-resource.openai.azure.com/"
    assert cfg.azure_openai_embedding_deployment == "legacy-embed-deployment"


def test_task_specific_provider_override_vars_parse(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER_DEFAULT", "azure_openai")
    monkeypatch.setenv("LLM_PROVIDER_PLANNER", "groq")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_PLANNER", "github_models")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_PLANNER", "planner-deploy")

    cfg = Settings(_env_file=None)

    assert cfg.llm_provider_default == "azure_openai"
    assert cfg.llm_provider_planner == "groq"
    assert cfg.llm_fallback_provider_planner == "github_models"
    assert cfg.azure_openai_deployment_planner == "planner-deploy"
