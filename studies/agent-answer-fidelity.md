# Agent answer fidelity: research review

Oct 7, 2026 · literature review for CardanoFish / PrefPool

**Question.** Respondent agents answer surveys on their owner's behalf. How do we make sure an answer reflects the owner (their habits, their actions, what they told the agent) rather than the model's own idea of a typical person? Do we need a clustering algorithm, or something else?

**Answer.** Clustering is not the fix. It segments a cohort for the buyer; it does not make any single answer true. The gap is per-answer grounding. Our existing calibration quiz and abstain rule cover part of it. The research points to the gap our writeup already discloses: on an ordinary campaign, an agent that guesses from model priors still gets paid.

> Caveat: this review was built from abstracts and search summaries, not full-paper reads. Check figures against the source papers before quoting them to buyers (especially the 3% / 54% figure, which comes from a news summary).

## 1. Agents get the crowd right but individuals wrong

This is the core risk for an agent survey marketplace.

| Finding | Source |
| --- | --- |
| LLMs predict aggregate survey responses well but capture only **3% of individual variation**, against a **54% human test-retest** benchmark. Holds across 400,000+ participants and 6,000+ items; richer persona data, other models and fine-tuning did not close the gap. | [Model Wire summary](https://themodelwire.com/article/llms-fail-to-capture-individual-variation-in-large-scale-persona-study-01M1D8SDBMCTBFE76V02YHZXT2); related: [Beyond Averages (arXiv 2606.09013)](https://arxiv.org/pdf/2606.09013) |
| "Das Man" effect: LLM silicon samples homogenize toward the majority and under-represent minority opinions; accuracy is not structurally consistent across aggregation levels. | [arXiv 2507.02919](https://arxiv.org/pdf/2507.02919) |
| LLM "tastes" are a stylized facsimile of human taste, with a systematic positive bias toward liking things. | [arXiv 2606.30085](https://arxiv.org/abs/2606.30085) |
| Persona-conditioned LLMs as synthetic respondents: reliability assessment. | [arXiv 2602.18462](https://arxiv.org/pdf/2602.18462) |

**Implication.** An agent with thin owner knowledge still produces plausible answers that look fine in aggregate. A buyer cannot tell from the totals.

## 2. Fidelity scales with how much the agent really knows

| Finding | Source |
| --- | --- |
| Agents built from 2-hour interviews with 1,052 people replicate their General Social Survey answers **85% as accurately as the people replicate themselves** two weeks later; comparable on personality traits and experiment replications. | [Park et al., arXiv 2411.10109](https://arxiv.org/abs/2411.10109v1), [code](https://github.com/joonspk-research/genagents) |
| Twin-2K-500: 2,000+ people answering 500+ questions; a ready dataset for testing digital-twin fidelity. | [arXiv 2505.17479](https://arxiv.org/pdf/2505.17479) |
| Customer digital twins built from a person's own reviews replicate them in conjoint analysis. | [arXiv 2604.22756](https://arxiv.org/pdf/2604.22756) |
| When can digital twins substitute for human measurement: behavioral fidelity vs. statistical substitutability. | [arXiv 2609.07987](https://arxiv.org/html/2609.07987) |
| PrefEval (ICLR 2025): models infer and follow user preferences poorly from conversation; zero-shot preference following drops **below 10% at about 10 turns** (~3k tokens). | [arXiv 2502.09597](https://arxiv.org/html/2502.09597v1) |

**Implication.** Answers grounded in rich owner data (checked config, task history, things the owner said) can be good. Answers the agent infers from scattered chat history are weak. Our source taxonomy (checked fact > owner told > inferred > abstain) matches the evidence.

## 3. Clustering preferences from habits and survey answers

- **Latent class analysis (LCA)** is the standard method for finding hidden segments from observed behaviors and attitudes, often combined with conjoint analysis.
- Combining **revealed** (what people did) and **stated** (what they said) preference data in one latent class model: [Transportation Research A, 2008](https://ideas.repec.org/a/eee/transa/v42y2008i1p227-242.html).
- Traditional segmentation misses preference heterogeneity in 5,800 airline passengers; LCA recovers it: [Endrizzi thesis](https://amsdottorato.unibo.it/667).
- Overview: [LCA glossary](https://sightx.io/glossary/latent-class-analysis-lca), [latent class conjoint segmentation](https://metricgate.com/docs/latent-class-conjoint-segmentation/).

**Implication.** Useful as a buyer-facing report feature (segments of the cohort), not as a truthfulness check.

## 4. Rewarding honesty when answers can't be checked

- **Bayesian Truth Serum** (Prelec 2004) and **peer prediction** pay respondents for answers that are "surprisingly common" relative to the group's predictions, without ground truth. BTS needs a large pool; peer prediction works with as few as three. [Overview, arXiv 2409.07277](https://arxiv.org/pdf/2409.07277); [Witkowski & Parkes](https://econcs.seas.harvard.edu/resource/witkowskiaaai12pdf).
- **Why not for us:** both assume respondents hold independent private signals. Our agents mostly run on a few shared base models with shared priors, so these mechanisms would tend to reward converging on the model's default answer. Do not adopt without a fix for correlated priors.

## 5. Knowing when to abstain

- **Conformal prediction / selective prediction** lets a model answer only when confident, with a statistical cap on the error rate among answered items. [Conformal prediction for NLP survey](https://alphaxiv.org/abs/2405.01976); [risk-controlled refusal](https://arxiv.org/html/2509.01455v2); [UQ survey, arXiv 2412.05563](https://arxiv.org/pdf/2412.05563); [UQ for LLM agents, arXiv 2609.07395](https://arxiv.org/pdf/2609.07395).
- **Implication.** The calibration quiz already produces labeled agent-vs-owner data per agent. That is exactly the calibration set conformal methods need to set a per-agent abstain threshold.

## Recommendations (priority order)

1. **No-context baseline check (main new algorithm).** For each question, also run the same model with no owner context. If the agent's answer equals the context-free baseline, it may come from model priors rather than the owner: mark it `prior_consistent` in CRE and down-weight it in aggregation. This targets the "typical person" failure directly and partly closes the "guessing would pay" gap, because a pure guess is flagged instead of counted like any other answer.
2. **Required source tag per answer.** Make `source ∈ {checked, owner_told, inferred}` a field on `submit_answer`, sealed with the answer. CRE reports results split by source; buyers can restrict a campaign to `checked` only.
3. **Calibration as a weight, not just a gate.** Use each agent's quiz score as an aggregation weight. Let agents use their quiz results to set their own abstain threshold (conformal-style).
4. **Optional segmentation, inside CRE only.** If buyers want segments, run LCA or k-modes on the decrypted cohort and publish a segment only if it meets `min_cohort`. Never cluster on the platform server or the owner device.

Possible next step: spec item 1 against the CRE aggregate step (`cre/aggregate/main.ts`).
