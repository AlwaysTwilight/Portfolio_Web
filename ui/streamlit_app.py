from __future__ import annotations

import os
from typing import Any

import requests
import streamlit as st


API_BASE_URL = os.getenv("API_BASE_URL", "http://api:8001")


def api_get(path: str) -> Any:
    response = requests.get(f"{API_BASE_URL}{path}", timeout=60)
    response.raise_for_status()
    return response.json()


def api_post_json(path: str, payload: dict[str, Any]) -> Any:
    response = requests.post(f"{API_BASE_URL}{path}", json=payload, timeout=120)
    response.raise_for_status()
    return response.json()


def api_upload(file_obj, logical_document_key: str, source_label: str, ingest_now: bool) -> Any:
    files = {"file": (file_obj.name, file_obj.getvalue(), file_obj.type or "application/octet-stream")}
    data = {
        "logical_document_key": logical_document_key,
        "source_label": source_label,
        "ingest_now": str(ingest_now).lower(),
    }
    response = requests.post(f"{API_BASE_URL}/upload", files=files, data=data, timeout=300)
    response.raise_for_status()
    return response.json()


def render_documents() -> None:
    st.subheader("Indexed Documents")
    try:
        documents = api_get("/documents")
    except requests.RequestException as exc:
        st.error(f"Could not load documents: {exc}")
        return

    if not documents:
        st.info("No documents indexed yet.")
        return

    for doc in documents:
        with st.expander(f"{doc['logical_document_key']}"):
            st.write(f"Active version: `{doc.get('active_version_id') or 'none'}`")
            st.write(f"Updated at: `{doc.get('updated_at') or 'unknown'}`")
            for version in doc.get("versions", []):
                status = "active" if version["is_active"] else "inactive"
                st.write(
                    f"- `{version['version_id']}` | `{version['file_name']}` | `{version['status']}` | `{status}` | chunks: `{version['chunk_count']}`"
                )


def render_upload() -> None:
    st.subheader("Upload And Index")
    with st.form("upload_form", clear_on_submit=False):
        uploaded_file = st.file_uploader("Choose a PDF, DOCX, TXT, or Markdown file", type=["pdf", "docx", "txt", "md", "markdown"])
        logical_document_key = st.text_input("Logical document key", placeholder="resume")
        source_label = st.text_input("Source label", placeholder="My Resume")
        ingest_now = st.checkbox("Ingest immediately", value=True)
        submitted = st.form_submit_button("Upload")

    if submitted:
        if uploaded_file is None:
            st.error("Please choose a file.")
            return
        if not logical_document_key.strip():
            st.error("Please enter a logical document key.")
            return
        try:
            result = api_upload(uploaded_file, logical_document_key.strip(), source_label.strip(), ingest_now)
        except requests.RequestException as exc:
            detail = exc.response.text if exc.response is not None else str(exc)
            st.error(f"Upload failed: {detail}")
            return

        st.success("Upload completed.")
        st.json(result)


def render_chat() -> None:
    st.subheader("Chat")
    if "messages" not in st.session_state:
        st.session_state.messages = []

    for item in st.session_state.messages:
        with st.chat_message(item["role"]):
            st.markdown(item["content"])
            if item["role"] == "assistant" and item.get("sources"):
                st.caption("Sources")
                for source in item["sources"]:
                    label = source.get("source_label") or source["file_name"]
                    st.write(
                        f"- `{label}` | key: `{source['logical_document_key']}` | version: `{source['version_id']}` | chunk: `{source['chunk_index']}`"
                    )

    include_debug = st.checkbox("Include retrieval debug", value=False)
    prompt = st.chat_input("Ask about your uploaded files")
    if not prompt:
        return

    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    try:
        result = api_post_json("/chat", {"message": prompt, "include_debug": include_debug})
    except requests.RequestException as exc:
        detail = exc.response.text if exc.response is not None else str(exc)
        with st.chat_message("assistant"):
            st.error(f"Chat failed: {detail}")
        return

    st.session_state.messages.append(
        {
            "role": "assistant",
            "content": result["answer"],
            "sources": result.get("sources", []),
        }
    )
    with st.chat_message("assistant"):
        st.markdown(result["answer"])
        if result.get("sources"):
            st.caption("Sources")
            for source in result["sources"]:
                label = source.get("source_label") or source["file_name"]
                st.write(
                    f"- `{label}` | key: `{source['logical_document_key']}` | version: `{source['version_id']}` | chunk: `{source['chunk_index']}`"
                )
        if include_debug and result.get("debug"):
            st.caption("Retrieval Debug")
            st.json(result["debug"])


def main() -> None:
    st.set_page_config(page_title="Local RAG Tester", page_icon=":books:", layout="wide")
    st.title("Local RAG Tester")
    st.write(f"Connected backend: `{API_BASE_URL}`")

    left, right = st.columns([1, 1])
    with left:
        render_upload()
        st.divider()
        render_documents()
    with right:
        render_chat()


if __name__ == "__main__":
    main()
