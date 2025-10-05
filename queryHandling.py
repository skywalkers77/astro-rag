# rAG_with_cloudflare_and_gemini.py
from typing import List
import os

# LangChain imports
from langchain.schema import Document
from langchain.vectorstores import CloudflareVectorize
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI  # example; replace with your embeddings wrapper if using Cloudflare embeddings
from langchain.callbacks import get_openai_callback
from langchain_core.tools import Tool
from langchain_google_community import GoogleSearchAPIWrapper
from langcahin.agents import initialize_agent, AgentType


# Google GenAI / Gemini
from google import genai  # per google-genai SDK quickstart
# If your environment uses different import adjust per SDK docs.

# -------------------------
# Config / env
# -------------------------
CF_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CF_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
CF_INDEX_NAME = os.environ.get("CF_INDEX_NAME")   # replace
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
GOOGLE_CSE_ID = os.environ.get("GOOGLE_CSE_ID")

# Gemini init (google genai)
genai.configure(api_key=GEMINI_API_KEY)

# -------------------------
# Create vectorstore (LangChain Cloudflare wrapper)
# -------------------------
# NOTE: Use the same embedding model used for indexing. Here we show a placeholder embedding class.
embeddings = GoogleGenerativeAIEmbeddings(model="text-embedding-004")  # <-- Replace with your embedding class if you used Cloudflare embeddings

vectorstore = CloudflareVectorize(
    account_id=CF_ACCOUNT_ID,
    api_token=CF_API_TOKEN,
    index_name=CF_INDEX_NAME,
    embedding=embeddings
)
db_tool = Tool(
    name="vector_db",
    func=lambda q: vectorstore.similarity_search_with_score(q, top_k=5),  # from earlier code
    description="Use this to find answers from the private document database."
)

search = GoogleSearchAPIWrapper()
google_tool = Tool(
    name="google_search",
    func=search.run,
    description="Use this to search the web if the private DB does not contain enough info."
)

# -------------------------
# Retrieval helper
# -------------------------
def retrieve_docs(query: str, top_k: int = 8):
    # returns list of (Document, score)
    results = vectorstore.similarity_search_with_score(query, k=top_k)
    # results is list of (Document, score)
    return results

# -------------------------
# Compose context for LLM
# -------------------------
def build_context_snippet(matches: List, include_limit_chars=1500):
    """
    Build a prompt snippet from matches (list of (doc, score))
    returns: (context_text, provenance_list)
    """
    parts = []
    provenance = []
    for i, (doc, score) in enumerate(matches, start=1):
        text = doc.page_content.strip()
        # truncate to avoid huge prompts
        if len(text) > include_limit_chars:
            text = text[:include_limit_chars] + " …"
        parts.append(f"--- DOC {i} (id={doc.metadata.get('id','unknown')}, score={score:.4f}) ---\n{text}\n")
        provenance.append({
            "id": doc.metadata.get("id"),
            "score": score,
            "source": doc.metadata.get("source")
        })
    context_text = "\n\n".join(parts)
    return context_text, provenance

# -------------------------
# System prompts for the two modes
# -------------------------
SYSTEM_PROMPT_DB_ONLY = """
You are an assistant that MUST ONLY use the provided documents below to answer the user's question.
Do NOT use any external knowledge beyond these documents. If the documents do NOT contain enough
information to answer the question, reply exactly: "NOT_IN_DB". Provide a short justification
(one sentence) referencing which documents you used, and include the doc ids used.
"""

SYSTEM_PROMPT_HYBRID = """
You are an assistant that SHOULD PRIORITIZE the provided vector_db when answering.
You MAY use external knowledge and the google_search to help if the vector_db doesn't fully answer the question,
Rephrase the user’s query if needed before calling google_search. but prefer the vector_db content. When using vector_db content, 
explicitly cite the doc ids and scores.If the vector_db is sufficient, do not add external facts unless they are directly relevant.
"""

# -------------------------
# Gemini call wrapper
# -------------------------
def call_gemini_with_context(system_prompt: str, user_query: str, context: str, temperature=0.0, max_output_tokens=512):
    # Build prompt payload per Gemini generate API docs
    prompt = f"{system_prompt}\n\nCONTEXT:\n{context}\n\nUSER QUERY:\n{user_query}\n\nAnswer:"
    response = genai.generate(
        model="gemini-2.5-flash",
        input=prompt,
        temperature=temperature,
        max_output_tokens=max_output_tokens
    )
    # SDK returns response object — extract text
    text = response.output[0].content[0].text
    return text, response

# -------------------------
# The main RAG flow
# -------------------------
def answer_query(query: str, mode: str = "db-only", top_k: int = 8, score_threshold=0.72):
    if mode == "db-only":
        matches = retrieve_docs(query, top_k=top_k)  # list of (Document, score)
        if not matches:
            # if mode == "db-only":
            return "NOT_IN_DB", {"provenance": []}
            # else:
            #     # no matches: still call Gemini with empty context (or with a note)
            #     context_text = "(no matching documents found in DB)"
            #     sys_prompt = SYSTEM_PROMPT_HYBRID
            #     answer, raw = call_gemini_with_context(sys_prompt, query, context_text)
            #     return answer, {"provenance": []}

        # check top score
        top_score = matches[0][1]
        context_text, provenance = build_context_snippet(matches)

        # If top result is below threshold, return NOT_IN_DB (strict behavior)
        if top_score < score_threshold:
            return "NOT_IN_DB", {"provenance": provenance}
        sys_prompt = SYSTEM_PROMPT_DB_ONLY
        answer, raw = call_gemini_with_context(sys_prompt, query, context_text)
        # If the model returns something other than NOT_IN_DB we accept it (it should rely only on context)
        return answer, {"provenance": provenance, "raw": raw}

    elif mode == "hybrid":
        # Always pass DB context, but allow external knowledge — instruct to prioritize DB
        # sys_prompt = SYSTEM_PROMPT_HYBRID
        # answer, raw = call_gemini_with_context(sys_prompt, query, context_text)
        # return answer, {"provenance": provenance, "raw": raw}
        llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash")

        tools = [db_tool, google_tool]
        agent = initialize_agent(
            tools=tools,
            llm=llm,
            agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
            verbose=True
        )
        answer = agent.run(query)
        return answer, {"provenance": provenance, "raw": raw}
        

    else:
        raise ValueError("mode must be 'db-only' or 'hybrid'")
