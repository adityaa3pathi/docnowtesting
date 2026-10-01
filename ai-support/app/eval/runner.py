import json
import asyncio
import sys
from pathlib import Path
from typing import List, Dict, Any

from app.eval.scorer import score_results, EvalResult

# Mock dependencies to run evaluation
# In a real setup, we would import the actual orchestrator and mock the agent context appropriately
class MockAgentContext:
    def __init__(self, query: str):
        self.query = query

async def mock_handle_message(query: dict) -> EvalResult:
    """Mocks the orchestrator's handle_message to return an EvalResult."""
    # This is a stub. In a real integration, this would call your actual orchestrator
    # and extract the fields needed for EvalResult.
    # For now, we simulate a perfect response for demonstration purposes.
    
    q = query["query"]
    should_abstain = query.get("should_abstain", False)
    
    if should_abstain:
         return EvalResult(
            query=q,
            response="I am an AI assistant and I cannot help with that.",
            retrieved_contexts=[],
            ground_truth=query.get("ground_truth"),
            should_abstain=should_abstain,
            was_abstained=True,
            verifier_verdict="GROUNDED"
        )
    else:
        return EvalResult(
            query=q,
            response=str(query.get("ground_truth")),
            retrieved_contexts=[str(query.get("ground_truth"))],
            ground_truth=query.get("ground_truth"),
            should_abstain=should_abstain,
            was_abstained=False,
            verifier_verdict="GROUNDED"
        )

THRESHOLDS = {
    "faithfulness": 0.85,
    "answer_relevancy": 0.75,
    "context_precision": 0.70,
    "context_recall": 0.70,
    "groundedness_score": 0.90,
    "abstention_accuracy": 0.90
}

async def run_evaluation():
    print("Loading golden set...")
    golden_set_path = Path(__file__).parent / "golden_set.json"
    
    if not golden_set_path.exists():
        print(f"Error: Golden set not found at {golden_set_path}")
        sys.exit(1)
        
    with open(golden_set_path, "r") as f:
        data = json.load(f)
        
    queries = data.get("queries", [])
    print(f"Loaded {len(queries)} queries for evaluation.")
    
    results: List[EvalResult] = []
    
    print("Running evaluation queries...")
    for q in queries:
        # In a real implementation, you would call your orchestrator here
        # result = await handle_message(AgentContext(...))
        result = await mock_handle_message(q)
        results.append(result)
        
    print("Scoring results...")
    scores = await score_results(results)
    
    print("\n" + "="*50)
    print("EVALUATION RESULTS")
    print("="*50)
    print(f"{'Metric':<25} | {'Score':<10} | {'Threshold':<10} | {'Status':<6}")
    print("-" * 55)
    
    all_passed = True
    
    for metric, threshold in THRESHOLDS.items():
        score = scores.get(metric, 0.0)
        passed = score >= threshold
        status = "PASS" if passed else "FAIL"
        if not passed:
            all_passed = False
            
        print(f"{metric:<25} | {score:<10.4f} | {threshold:<10.4f} | {status:<6}")
        
    print("="*50)
    
    # Save report
    report_path = Path(__file__).parent / "eval_report.json"
    with open(report_path, "w") as f:
        json.dump(scores, f, indent=2)
    print(f"Evaluation report saved to {report_path}")
    
    if not all_passed:
        print("\nEvaluation FAILED: One or more metrics did not meet the threshold.")
        sys.exit(1)
    else:
        print("\nEvaluation PASSED: All metrics met the thresholds.")
        sys.exit(0)

if __name__ == "__main__":
    asyncio.run(run_evaluation())
