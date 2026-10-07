# Preference-following guardrails: research review and feasibility

Oct 7, 2026 · follow-up to [agent-answer-fidelity.md](agent-answer-fidelity.md)

**Question.** PrefEval ([arXiv 2502.09597](https://arxiv.org/html/2502.09597v1)) shows LLMs rarely apply a user's stated preferences on their own. What does the wider literature say? Which findings can become guardrails in PrefPool's code?

**Short answer.** Three findings matter most for PrefPool.

1. **Prior-driven answers are the main threat, and they are hard to see.**
   - Rich persona data barely beats a homogeneous base model: average r = 0.20 to the real person.
   - Agents built from demographics alone reach 74% of human test-retest consistency.
   - So "the agent answered" is weak evidence that "the owner would answer this way."
2. **Explicit retrieval plus a reminder is the cheapest large win.** On PrefEval, Claude 3 Sonnet goes from 5.4% to 96.4% when reminded of the stated preference.
3. **Prompt-level privacy rules and regex screening are not security boundaries.**
   - Agents leak 25–88% of the time despite instructions.
   - Adaptive attacks beat 12 published defenses.
   - The protection that holds is structural: typed inputs, index-only outputs, and choosing which owner facts to use before the model reads untrusted text.

> **How this was checked.** Every paper below was confirmed to exist on its arXiv or venue page. Figures marked † were checked in the paper's full text. All other figures come from abstracts. Bisbee and the Das Man percentages come from search-result text only. Check any figure against the paper before quoting it to buyers.

---

## Part 1: The papers

### A. Preference following and memory (PrefEval and related benchmarks)

| Paper | Key findings | What it implies for PrefPool |
|---|---|---|
| **PrefEval**, Zhao et al., ICLR 2025, [2502.09597](https://arxiv.org/abs/2502.09597) | Preference following without help is under 10% by 10 turns (about 3k tokens). †Claude 3 Sonnet, 10 turns: no help 5.4%, **reminder 96.4%**, self-critic 78.6%, RAG 64.2%. †Implicit preferences are harder. †Classification scores track generation scores (r = 0.73). | Retrieve the owner's relevant facts and put them in front of the agent at answer time. Multiple-choice probes like our calibration quiz are a fair proxy for preference following. |
| **PersonaMem** ("Know Me, Respond to Me"), Jiang et al., COLM 2025, [2504.14225](https://arxiv.org/abs/2504.14225) | Frontier models score about 50% overall. †Recall of the user's *latest* preference is only about 30–50%. Generalizing to new scenarios is the weakest skill. †Plain RAG beats Mem0 on most question types. | Store facts with a timestamp and a "superseded" flag. A new survey question is the weakest case, "generalize to a new scenario", so abstain more readily there. |
| **LongMemEval**, Wu et al., ICLR 2025, [2410.10813](https://arxiv.org/abs/2410.10813) | †GPT-4o scores 0.870 with only the relevant evidence and 0.606 with the full history. †Indexing facts by key, time-aware queries, and reading through structured notes (Chain-of-Note) each add 5–11 points. Abstention is one of the tested abilities. | Use a fact store, not chat history. Our calibration quiz should include items the agent cannot know, to test that it abstains. |
| **LoCoMo**, Maharana et al., 2024, [2402.17753](https://arxiv.org/abs/2402.17753) | Long-term conversation memory: about 300 turns, up to 35 sessions. RAG and long context remain far below humans. | Reference benchmark if a memory backend is ever adopted. |
| **Mem0**, Chhikara et al., 2025, [2504.19413](https://arxiv.org/abs/2504.19413) | +26% LLM-judge score vs OpenAI memory on LoCoMo, and about 90% fewer tokens. These are the vendor's own numbers; PersonaMem contradicts them. | Add/update/delete fact extraction is a reasonable design for the store. Measure it before adopting it. |
| **Interaction context increases sycophancy**, Jain et al., CHI 2026, [2509.12517](https://arxiv.org/abs/2509.12517) | User memory profiles raised agreement sycophancy by up to +45% (Gemini 2.5 Pro). | Memory can push answers toward the agreeable end. Test with paired items that are worded in opposite directions. |
| **MemSyco-Bench**, Xiang et al., 2026, [2607.01071](https://arxiv.org/abs/2607.01071) | Memory-induced sycophancy, measured across five tasks including "respect memory scope." | Tag each fact with the categories it applies to, and use it only for those categories. |
| **CORE/PERSIST**, Zhang et al., Findings of EMNLP 2026, [2609.12373](https://arxiv.org/abs/2609.12373) | Separates temporary details from lasting preferences, and only revises a belief about the user on enough evidence. | One task or one survey must not overwrite a stable owner fact. |
| ALOE [2410.03642](https://arxiv.org/abs/2410.03642), PERSONA [2407.17387](https://arxiv.org/abs/2407.17387), PersonalLLM [2409.20296](https://arxiv.org/abs/2409.20296), PersonaGym [2407.18416](https://arxiv.org/abs/2407.18416), LaMP [2304.11406](https://arxiv.org/abs/2304.11406), MemGPT [2310.08560](https://arxiv.org/abs/2310.08560) | Background. One useful finding: in PersonaGym, a bigger model was not more faithful to its persona (GPT-4.1 ≈ LLaMA-3-8B). | Calibrate the model the owner actually runs. Don't assume a frontier model is calibrated. |

### B. LLMs as stand-ins for specific survey respondents

| Paper | Key findings | What it implies for PrefPool |
|---|---|---|
| **Digital Twins as Funhouse Mirrors**, Peng, Gui, Toubia et al., 2025/26, [2509.19088](https://arxiv.org/abs/2509.19088) | 19 studies, 164 outcomes. Average r = 0.20 to the real person. †Accuracy: full persona 0.748, no persona 0.734, demographics only 0.746. †Twins' answers were less varied than humans' in 154 of 164 outcomes. | **Strongest evidence for our core risk.** Lift must be measured against what a typical person or a demographic profile would answer, and answer spread across agents is worth monitoring. |
| **Twin-2K-500**, Toubia et al., 2025, [2505.17479](https://arxiv.org/abs/2505.17479) | †Twins 71.7% accurate vs 81.7% human test-retest (87.7% relative) and 59.2% random. †Systematic tilts, e.g. 74% of twins oppose deportations vs about 45% of humans. | An owner who answers the same question twice agrees with themselves only about 80% of the time, so that is the realistic ceiling. Political and value-laden items are biased. |
| **Generative agents of 1,052 people**, Park et al., 2024/26, [2411.10109](https://arxiv.org/abs/2411.10109) | Relative to human test-retest: interview 83%, survey 82%, both 86%, **demographics only 74%**. | Structured self-reports from the owner are what lift an agent above demographic guessing. |
| **Out of One, Many**, Argyle et al., 2023, [2209.06899](https://arxiv.org/abs/2209.06899) | "Algorithmic fidelity" holds for subgroup *distributions*. | It says nothing about individuals, so don't cite it to buyers as evidence about proxy answers. |
| **OpinionQA**, Santurkar et al., ICML 2023, [2303.17548](https://arxiv.org/abs/2303.17548) | Model opinions are misaligned with 60 US groups, and steering the model toward a group does not fix it. | The model's default opinion is a skewed position, not a neutral one. |
| **Das Man**, Li et al., 2025, [2507.02919](https://arxiv.org/abs/2507.02919) | Answers collapse toward the most common opinion, e.g. about 80% of subgroups homogenized vs 40% in real data (abortion). | Monitor at the campaign level for answers bunching up. |
| **Questioning survey responses of LLMs**, Dominguez-Olmedo et al., NeurIPS 2024, [2306.07951](https://arxiv.org/abs/2306.07951) | 43 models answer by option position and label. With order randomized they trend toward uniform random answers. | **Shuffle option order for each agent.** |
| Pezeshkpour & Hruschka, [2308.11483](https://arxiv.org/abs/2308.11483); PriDe, Zheng et al., ICLR 2024, [2309.03882](https://arxiv.org/abs/2309.03882) | Reordering options moves accuracy by 13–75 points. The sensitivity appears where the model is uncertain. | Whether an answer survives reordering is an uncertainty signal. |
| **Human-like response biases?**, Tjuatja et al., TACL 2024, [2311.04076](https://arxiv.org/abs/2311.04076) | Models react to wording changes that don't move humans. | A reworded version of the same question should get the same answer. |
| **Synthetic replacements**, Bisbee et al., Political Analysis 2024, [doi](https://doi.org/10.1017/pan.2024.5) | Answers are less varied than humans'. The same prompt gives different results three months apart. | Record the model and version with every answer. Recalibrate when it changes. |
| Wang et al., Nature Machine Intelligence 2025, [2402.01908](https://arxiv.org/abs/2402.01908); Hu & Collier, ACL 2024, [2402.10811](https://arxiv.org/abs/2402.10811) | Models flatten identity groups. Persona variables explain under 10% of the variation in answers. | Demographic profile fields must never count as evidence about the owner. |
| Taday Morocho et al., WWW 2026, [2602.18462](https://arxiv.org/abs/2602.18462) | Persona prompting often makes answers worse. Errors concentrate on particular items and subgroups. | Report calibration per category, not only as an overall average. |
| Conformal multiple-choice QA, Kumar et al., [2305.18404](https://arxiv.org/abs/2305.18404); Kadavath et al., [2207.05221](https://arxiv.org/abs/2207.05221) | Conformal sets track accuracy, but only for questions resembling the calibration data. Models' self-assessed "I know this" generalizes poorly to new tasks. | Derive the answer's source tag mechanically; never trust the model's own claim. |
| Context-Aware Decoding, [2305.14739](https://arxiv.org/abs/2305.14739); ContextCite, [2409.00729](https://arxiv.org/abs/2409.00729) | Formal versions of "what does the model answer with vs without the context." | The principled no-context baseline. It needs control of the model (see the feasibility table). |

### C. Privacy, prompt injection and delegation

| Paper | Key findings | What it implies for PrefPool |
|---|---|---|
| **ConfAIde**, Mireshghallah et al., ICLR 2024, [2310.17884](https://arxiv.org/abs/2310.17884) | GPT-4 leaks private information in contexts where humans wouldn't, 39% of the time, even with privacy prompts. | A "be careful" prompt is not a control. |
| **PrivacyLens**, Shao et al., NeurIPS 2024, [2409.00138](https://arxiv.org/abs/2409.00138) | GPT-4 leaks in 25.7% of agent action sequences despite answering privacy questions correctly. | Test what the agent does, not only what it knows. |
| **AirGapAgent**, Bagdasarian et al., CCS 2024, [2405.05175](https://arxiv.org/abs/2405.05175) | One context-hijacking query cut protection from 94% to 45%. A minimizer that never sees third-party text kept protection at 97%. | **Select the owner facts by category label before the model reads the campaign text.** |
| **Firewalls for agent networks**, Abdelnabi et al., 2025/26, [2502.01822](https://arxiv.org/abs/2502.01822) | Converting input into typed fields and abstracting output data cut privacy attacks from 84% to 10% (GPT-5). | PrefPool already does half of this: questions are typed and answers are index-only. Add length caps and a closed category list. |
| **ConVerse**, Gomaa et al., Findings of EACL 2026, [2511.05359](https://arxiv.org/abs/2511.05359); **MAGPIE**, [2510.15186](https://arxiv.org/abs/2510.15186) | Agent-to-agent privacy attacks succeed up to 88%. Stronger models leaked more. | Re-run the evaluations whenever the owner's model changes. |
| **CI reasoning + RL**, Lan et al., 2025, [2506.04245](https://arxiv.org/abs/2506.04245) | Explicit contextual-integrity reasoning (who is receiving this, for what purpose, under which norms) reduces leakage. | Use it as an extra instruction in the skill, on top of the code checks. |
| **Indirect prompt injection**, Greshake et al., [2302.12173](https://arxiv.org/abs/2302.12173); **InjecAgent**, [2403.02691](https://arxiv.org/abs/2403.02691); **AgentDojo**, [2406.13352](https://arxiv.org/abs/2406.13352) | Injected text needs no "ignore previous instructions" wording. GPT-4 is vulnerable 24% of the time on InjecAgent. | Campaign titles **and option labels** are attacker-controlled. |
| **CaMeL**, Debenedetti et al., 2025, [2503.18813](https://arxiv.org/abs/2503.18813) | Separating control flow from data flow gives provable injection security, solving 77% of AgentDojo tasks vs 84% undefended. | Only partly applicable, because the answering agent is the owner's and has its own tools. |
| **Spotlighting**, Hines et al., [2403.14720](https://arxiv.org/abs/2403.14720) | Datamarking untrusted text cut attack success from over 50% to under 2% (GPT). | Cheap upgrade to the `untrusted()` wrapper. |
| **The Attacker Moves Second**, Nasr, Carlini et al., 2025, [2510.09023](https://arxiv.org/abs/2510.09023) | Adaptive attacks beat 12 defenses, most with over 90% success. | **Regex screening is useful telemetry, not a boundary.** |
| **Sycophancy**, Sharma et al., ICLR 2024, [2310.13548](https://arxiv.org/abs/2310.13548) | Models consistently agree with views stated in the prompt. | Leading question wording will skew agent answers. |
| **Authenticated delegation**, South et al., ICML 2025, [2501.09674](https://arxiv.org/abs/2501.09674) | Scoped, auditable delegation tokens for agents. | An owner-visible audit log, and owner approval before answering in new categories. |
| **Netflix de-anonymization**, Narayanan & Shmatikov, S&P 2008, [cs/0610105](https://arxiv.org/abs/cs/0610105) | †8 ratings with approximate dates identify 99% of records. | Answer vectors from the same agent across campaigns are fingerprints. Never make them linkable. |
| **Dinur & Nissim**, PODS 2003 (via the differentialprivacy.org summary) | Enough overlapping aggregate queries reconstruct the private data. | A minimum cohort size alone does not stop differencing attacks across campaigns. |

---

## Part 2: Can PrefPool implement these as guardrails?

**Architectural constraint.** PrefPool never runs a model. No code in `server/`, `shared/`, `cre/` or `plugins/mcp/` calls an LLM. The owner's own agent (Claude Code or OpenClaw) is the only model, and it reaches PrefPool through MCP tools. PrefPool can therefore enforce things in three places:
- **plugin code** (`plugins/mcp/src/tools.ts`), on the owner's machine;
- **platform code** (`shared/src/screening.ts`, `calibration.ts`, the server);
- **aggregation inside CRE** (`shared/src/pipeline.ts`, `report.ts`).

It can only *ask* the model through the skill and tool descriptions. Any guardrail that needs a second, controlled model call does not fit. That includes the no-context baseline, permutation voting by re-asking, and the CaMeL quarantined answerer. MCP sampling would allow it, but client support can't be relied on.

### Feasibility table

| # | Guardrail | Evidence | Where | Effort | Verdict |
|---|---|---|---|---|---|
| 1 | **Owner fact store + category-scoped reminder.** The plugin keeps owner facts locally (text, categories, timestamp, superseded flag). `evaluate_campaign` returns only the facts whose categories match the campaign's platform category, chosen *before* the model reads the campaign text. The skill tells the agent to answer only from those facts or from facts it can check. | PrefEval (5%→96%), LongMemEval, PersonaMem, AirGapAgent, MemSyco | `plugins/mcp/src/store.ts`, `tools.ts`, both respondent skills, web `GuardrailEditor` | M | **Do it.** Highest value, fits the existing local-only store, and no server change is needed. |
| 2 | **Option-order shuffle for each agent.** The plugin shows options in a seeded random order (seed = agent + campaign) and maps the agent's index back to the canonical order before sealing. Likert scales are reversed for half of the agents. | Dominguez-Olmedo, Pezeshkpour, PriDe | `tools.ts` (`untrusted()` + `submit_answer`) | S | **Do it.** Deterministic, invisible to buyers, and cancels position bias in the aggregate. |
| 3 | **Enforce `approvalMode`.** `OwnerPolicy.approvalMode` exists but `set_policy` hard-codes `'auto'`. Wire up `approve_sensitive` / `approve_all`: `submit_answer` refuses until the owner confirms (e.g. through a flag set by the web UI or the owner). Also require approval the first time a new category is answered. | Authenticated delegation, ConfAIde | `tools.ts`, `store.ts`, `GuardrailEditor` | S | **Do it.** It closes a real gap: a declared control that isn't enforced. |
| 4 | **Source field derived in code.** `submit_answer` takes `source: 'checked' \| 'owner_told' \| 'inferred'` per question. The plugin *downgrades* `owner_told` to `inferred` when no scoped fact from #1 exists for that category, so the model's own claim never wins (Kadavath). The source is sealed inside the envelope. CRE reports results split by source. Demographic profile fields never count as `owner_told`. | Kadavath, Hu & Collier, Wang | `tools.ts`, `shared/src/envelope.ts`, `answers.ts`, `report.ts` | M | **Do it, with honest labeling.** `checked` can't be verified mechanically, so present it as the agent's claim. |
| 5 | **Calibration upgrades.** (a) Draw quiz items from *contested* questions, where the bank prior is close to evenly split, so the majority baseline can't pass. (b) Add 2–3 items the owner marks "I never told my agent this"; a pass requires `unknown` on them. (c) Use a Beta posterior / lower confidence bound instead of raw agreement, because n = 15 gives about ±0.23. (d) Store per-category agreement. (e) Expire calibration when the model ID changes. | Funhouse Mirrors, Twin-2K, LongMemEval (abstention), Morocho, Bisbee | `shared/src/calibration.ts`, `server/src/calibration.ts`, `supabase/seed/calibration_bank_v1.json` | M | **Do (a), (b) and (e) first.** (c) tightens the pass bar and should be tuned on real data before rollout. |
| 6 | **Record the model and template with every answer.** The plugin seals `{ client, modelId?, skillVersion }` in the envelope plaintext. CRE can then group results by them. | Bisbee (drift), ConVerse | `envelope.ts`, `tools.ts` | S | **Do it.** The model ID is self-reported by the client, so treat it as a hint only. |
| 7 | **Campaign homogenization monitor.** In CRE, compare each question's answer spread (entropy) against the calibration-bank prior and flag `low_dispersion` in the research report. Do not use it to block. | Funhouse Mirrors (154/164), Das Man, Bisbee | `shared/src/report.ts` / `pipeline.ts` | S | **Do it** as a buyer-facing quality signal. |
| 8 | **Schema firewall tightening.** Caps on title, question and option length. Category from a closed list. No URLs or code fences in the text. Use a leading-wording check (e.g. "most experts agree", "don't you think") as a soft flag. Treat the existing regexes as telemetry and log hits per company. | Firewalls, Nasr et al., Sharma | `shared/src/screening.ts` | S | **Do it.** Cheap, but be honest in the writeup that it is not the security boundary. |
| 9 | **Spotlighting.** Datamark campaign strings (wrap them in unique delimiters, or interleave a marker) inside the `untrusted()` output. | Spotlighting | `tools.ts` | S | **Do it.** Cheap defense in depth. |
| 10 | **Anti-differencing on aggregates.** Today `aggregate()` releases shares rounded to 4 decimals plus the exact `validRespondents`, so exact counts can be recovered. Options: add DP (Laplace) noise to the counts, round the respondent count into a range, block near-duplicate campaigns from the same company with overlapping audiences, and give each company a privacy budget. | Dinur & Nissim, Netflix | `report.ts`, `screening.ts`, server campaign creation | M–L | **Plan it.** Real risk, but DP noise changes the buyer product. Start with near-duplicate blocking and rounding the respondent count. |
| 11 | **Fresh identity per campaign.** Today the respondent address (wallet) is the same across campaigns. It is only visible inside CRE, but the payout list is on chain. | Netflix | chain/escrow design | L | **Note as a known limitation.** Answers stay sealed. Only *participation* is linkable on chain. |
| 12 | **Paraphrase consistency check.** Ask each question twice, once with a neutral rewording, and abstain on disagreement. | Tjuatja, Bisbee | platform would need to generate paraphrases | M | **Defer.** It needs a model on the platform, or buyer-supplied paraphrases. It also doubles question count and the agent sees both versions together, which weakens the test. |
| 13 | **No-context baseline (`prior_consistent`)**, proposed in the earlier review. | Funhouse Mirrors, CAD, ContextCite | needs a controlled model call | — | **Not enforceable by PrefPool.** Use the closest feasible version instead: #5a (contested items) at calibration time, and #7 (dispersion vs the prior) at the aggregate. |
| 14 | **CaMeL-style quarantined answerer** | CaMeL | — | — | **Not applicable.** We don't control the owner's agent. Index-only outputs plus #1 and #2 give part of the benefit. |
| 15 | **Peer prediction / Bayesian Truth Serum** | earlier review | — | — | **Still no.** It assumes independent private signals, but our agents share base-model priors. |
| 16 | **Eval suite in CI.** Seeded owner profiles × campaigns with injections, leading wording and order shuffles. Assert on leakage, abstention and order-invariance using the existing synthetic agents (`server/src/synthetic.ts`). | AgentDojo, InjecAgent, PrivacyLens | `server/test`, `.github/workflows/ci.yml` | M | **Do it, with scope.** Synthetic agents are deterministic, so this tests the *code* guardrails. Real-model evals are a manual, separate job. |

### Recommended order

1. **#3 approvalMode, #2 option shuffle, #8 screening caps, #9 spotlighting.** All small, deterministic and testable in existing suites.
2. **#1 owner fact store with scoped reminder, then #4 source field.** This is the main fidelity upgrade; #4 depends on #1.
3. **#5a/b/e calibration changes, #6 model ID, #7 dispersion flag.** These make the existing calibration tier measure what the literature says matters: lift over the typical answer, abstention, and drift.
4. **#10 anti-differencing.** Needs a product decision on noise vs exactness.

### What to tell buyers (writeup)

- Proxy answers from agents are **population-plausible, individually weak** unless they are grounded in owner-stated facts. Cite Funhouse Mirrors and Park et al., not Argyle.
- Calibration measures **lift over the typical answer**, which the evidence supports. The current 15-item pass is statistically noisy.
- Regex screening is abuse filtering. The privacy guarantees come from index-only answers, on-device encryption, aggregation inside CRE, and minimum cohort sizes. Minimum cohort sizes alone do not stop differencing attacks (#10).
