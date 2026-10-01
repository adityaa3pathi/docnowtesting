from dataclasses import dataclass
from typing import List, Dict, Optional, Any
import pandas as pd
from datasets import Dataset

try:
    from ragas import evaluate
    from ragas.metrics import (
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall,
    )
    from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
except ImportError:
    pass

@dataclass
class EvalResult:
    query: str
    response: str
    retrieved_contexts: List[str]
    ground_truth: Optional[str]
    should_abstain: bool
    was_abstained: bool
    verifier_verdict: str

async def score_results(results: List[EvalResult]) -> Dict[str, float]:
    """Scores a list of EvalResults using RAGAS and custom metrics."""
    
    # Custom Metrics
    total = len(results)
    if total == 0:
        return {}

    correct_abstentions = 0
    grounded_count = 0
    
    ragas_data = {
        "question": [],
        "answer": [],
        "contexts": [],
        "ground_truth": []
    }

    for res in results:
        # Abstention accuracy
        if res.should_abstain == res.was_abstained:
            correct_abstentions += 1
            
        # Groundedness score
        if res.verifier_verdict == "GROUNDED":
            grounded_count += 1
            
        # Prepare data for RAGAS (only for queries that shouldn't abstain and have ground truth)
        if not res.should_abstain and res.ground_truth:
            ragas_data["question"].append(res.query)
            ragas_data["answer"].append(res.response if not res.was_abstained else "I cannot answer this.")
            ragas_data["contexts"].append(res.retrieved_contexts if res.retrieved_contexts else [""])
            ragas_data["ground_truth"].append(res.ground_truth)
            
    abstention_accuracy = correct_abstentions / total if total > 0 else 0.0
    groundedness_score = grounded_count / total if total > 0 else 0.0

    scores = {
        "abstention_accuracy": abstention_accuracy,
        "groundedness_score": groundedness_score,
        "faithfulness": 0.0,
        "answer_relevancy": 0.0,
        "context_precision": 0.0,
        "context_recall": 0.0
    }

    # Run RAGAS if we have valid data
    if len(ragas_data["question"]) > 0:
        try:
            dataset = Dataset.from_dict(ragas_data)
            
            # Use Google GenAI for evaluation
            eval_llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash")
            eval_embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
            
            ragas_result = evaluate(
                dataset,
                metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
                llm=eval_llm,
                embeddings=eval_embeddings
            )
            
            # Update scores with RAGAS results
            for metric in ["faithfulness", "answer_relevancy", "context_precision", "context_recall"]:
                if metric in ragas_result:
                    scores[metric] = float(ragas_result[metric])
                    
        except Exception as e:
            print(f"Error running RAGAS evaluation: {e}")

    return scores
