# moyu.info Pricing(实测 2026-05-24)

148 模型,按"模型类型"分类拉取(virtual scroll 累计去重)

- 文本: 95 (期望 95)
- 图片: 12 (期望 12)
- 视频: 35 (期望 35)

## 文本模型 (text)

```
模型名称 供应商 描述 标签 计费类型 可用端点类型 模型价格
gpt-5.3-codex OpenAI GPT-5.3-Codex通过性能提升、功能泛化和安全性升级，重新定义了AI在编程及泛生产力领域的角色。 - 按量计费 openai 输入 ¥4.4880 / 1M tokens 输出 ¥35.9040 / 1M tokens Lite-GPT分组
gpt-5.4 OpenAI GPT-5.4 具备增强推理与编程能力、原生计算机操作（Computer-Use）、百万级上下文窗口及更强工具调用能力，面向智能体与复杂专业工作场景。 - 按量计费 openai 输入 ¥6.4060 / 1M tokens 输出 ¥38.4340 / 1M tokens Lite-GPT分组
claude-opus-4-6 Anthropic Claude Opus 4.6 是 Anthropic 当前最顶尖的旗舰模型，专为处理极高复杂度的任务而设计，尤其在编程、跨应用计算机操作（Computer Use）及长时程自主智能体（Agent）工作流方面展现了行业领先的推理深度与执行稳定性。 - 按量计费 anthropic openai 输入 ¥12.4810 / 1M tokens 输出 ¥62.3930 / 1M tokens Lite-Claude分组
claude-opus-4-7 Anthropic Opus 4.7 在高级软件工程方面相比 Opus 4.6 有了显著提升，尤其是在处理最复杂的任务方面。Opus 4.7 能够严谨且一致地处理复杂、耗时的任务，精准地执行指令，并在返回结果之前设计出验证自身输出的方法。 - 按量计费 anthropic openai 输入 ¥14.8470 / 1M tokens 输出 ¥74.2360 / 1M tokens Lite-Claude分组
claude-sonnet-4-6 Anthropic claude-sonnet-4-6是由 Anthropic 推出的高性能平衡型大模型版本，兼具强推理能力与稳定长上下文处理能力，适用于企业级复杂文本与 Agent 工作流场景。 - 按量计费 anthropic openai 输入 ¥12.8300 / 1M tokens 输出 ¥64.1500 / 1M tokens Lite-Claude分组 ⚠️(2026-06-07 实测账单 modelRate=12.83/outputRate=5 实收;原 2026-05-24 文档价 ¥7.486/¥37.43 已涨,catalog+DB 已同步至实收)
gemini-3.1-flash-lite-preview Gemini Gemini 3.1 Flash-Lite 最适合处理海量代理任务、简单的数据提取任务，以及预算和速度是主要限制因素的极低延迟应用。 - 按量计费 gemini openai 输入 ¥0.6840 / 1M tokens 输出 ¥4.1170 / 1M tokens Lite-gemini分组
gemini-3.1-pro-preview Gemini Gemini-3.1-Pro-Preview 是 Google 最新发布的旗舰级 预览版本大模型，定位在处理复杂推理、多步任务和高级工作流自动化场景。它是从 Gemini 3 Pro 进化而来，在多个核心能力上有明显提升并处于公开预览阶段。 - 按量计费 gemini openai 输入 ¥5.4730 / 1M tokens 输出 ¥32.8390 / 1M tokens Lite-gemini分组
gpt-4.1-mini OpenAI - - 按量计费 openai 输入 ¥0.2000 / 1M tokens 输出 ¥0.4000 / 1M tokens default(pro)分组
gpt-4.1-nano OpenAI GPT-4.1 nano 是由 openai 提供的人工智能模型。 - 按量计费 openai 输入 ¥0.5030 / 1M tokens 输出 ¥2.0130 / 1M tokens Lite-GPT分组
gpt-4o-2024-08-06 OpenAI GPT-4o（2024-11-20）是 OpenAI 的多模态旗舰大模型，支持文本、语音和视觉输入，拥有 128K token 超大上下文窗口；此次版本提升了创意写作能力与文件处理深度。 - 按量计费 openai 输入 ¥2.3160 / 1M tokens 输出 ¥3.4740 / 1M tokens max-gpt分组
gpt-4o-2024-11-20 OpenAI GPT-4o（2024-11-20）是 OpenAI 的多模态旗舰大模型，支持文本、语音和视觉输入，拥有 128K token 超大上下文窗口；此次版本提升了创意写作能力与文件处理深度。 - 按量计费 openai 输入 ¥6.4030 / 1M tokens 输出 ¥25.5990 / 1M tokens Lite-GPT分组
gpt-4o-mini OpenAI - - 按量计费 openai 输入 ¥0.0750 / 1M tokens 输出 ¥0.3000 / 1M tokens default(pro)分组
gpt-4o-mini-2024-07-18 OpenAI GPT-4o mini 是 OpenAI 性价比最高的小型模型，以极低成本和低延迟提供强大的文本与视觉能力。 它在 MMLU 取得 82% 的表现，定价比前沿模型低一个数量级，适合大上下文处理、多模型链式调用与实时交互场景。模型提供 128K 上下文、最高 16K 输出，并将扩展至更全面的多模态输入输出，是构建高频、成本敏感型应用的理想选择。 - 按量计费 openai 输入 ¥0.3810 / 1M tokens 输出 ¥1.5300 / 1M tokens Lite-GPT分组
gpt-5 OpenAI GPT-5 是 OpenAI 最新一代通用大模型，在多语言处理与文本创作方面实现了突破性提升。输出内容流畅自然、逻辑严谨，接近母语级水平。同时，GPT-5 支持跨文本、图像、音频、代码的全模态交互，相比上一代，GPT-5还能自主规划多步骤任务，联动外部工具高效完成复杂工作流，在法律、科研、医学、产品设计等专业场景中展现接近专家水准的能力。 - 按量计费 openai 输入 ¥3.2010 / 1M tokens 输出 ¥25.5960 / 1M tokens Lite-GPT分组
gpt-5-codex OpenAI GPT-5-Codex 是 OpenAI 在 2025 年推出的旗舰级专业编程模型，作为 GPT-5 系列的工程向强化版本，它专为软件开发、系统构建与复杂代码推理场景进行了深度优化。 相比通用模型，GPT-5-Codex 在代码理解、跨文件依赖解析、大型项目重构、自动测试生成与调试分析等方面具备更高准确率与一致性。模型同时具备更强的指令可控性、对工程规范的遵循能力。 - 按量计费 openai 输入 ¥4.7080 / 1M tokens 输出 ¥37.6400 / 1M tokens default(pro)分组
gpt-5-mini OpenAI - - 按量计费 openai 输入 ¥0.1250 / 1M tokens 输出 ¥1.0000 / 1M tokens default(pro)分组
gpt-5-nano OpenAI - - 按量计费 openai 输入 ¥0.0250 / 1M tokens 输出 ¥0.2000 / 1M tokens default(pro)分组
gpt-5.1 OpenAI GPT-5.1 是 OpenAI 推出的新一代通用大模型，聚焦更强推理能力、更稳定指令遵循与更低延迟，兼顾文本、图像等多模态理解，适用于复杂分析、Agent 构建与企业级智能应用场景。 - 按量计费 openai 输入 ¥3.2010 / 1M tokens 输出 ¥25.5960 / 1M tokens Lite-GPT分组
gpt-5.1-codex OpenAI - - 按量计费 openai 输入 ¥3.1960 / 1M tokens 输出 ¥25.5680 / 1M tokens Lite-GPT分组
gpt-5.2 OpenAI GPT-5.2 是 OpenAI 的通用大模型版本，强调更稳定的推理表现与指令遵循能力，支持多模态理解，适用于复杂业务分析与智能 Agent 场景。 - 按量计费 openai 输入 ¥4.4810 / 1M tokens 输出 ¥35.8350 / 1M tokens Lite-GPT分组
gpt-5.2-codex OpenAI - - 按量计费 openai 输入 ¥6.6000 / 1M tokens 输出 ¥52.8000 / 1M tokens default(pro)分组
gpt-5.4-mini OpenAI - - 按量计费 openai 输入 ¥1.8560 / 1M tokens 输出 ¥11.1380 / 1M tokens Lite-GPT分组
gpt-5.4-nano OpenAI - - 按量计费 openai 输入 ¥0.4950 / 1M tokens 输出 ¥3.0940 / 1M tokens Lite-GPT分组
gpt-5.5 OpenAI GPT-5.5是OpenAI于2026年4月24日发布的旗舰大语言模型，定位为面向实际工作与智能体的新型智能，核心突破在于自主规划与执行多步骤复杂任务，擅长编程、计算机操作、科研分析等领域，并以更少Token消耗实现更高效率 - 按量计费 openai 输入 ¥12.6070 / 1M tokens 输出 ¥75.6430 / 1M tokens Lite-GPT分组
gpt-5.5-pool OpenAI GPT-5.5是OpenAI于2026年4月24日发布的旗舰大语言模型，定位为面向实际工作与智能体的新型智能，核心突破在于自主规划与执行多步骤复杂任务，擅长编程、计算机操作、科研分析等领域，并以更少Token消耗实现更高效率 - 按量计费 openai 输入 ¥18.5400 / 1M tokens 输出 ¥111.2400 / 1M tokens all分组
claude-haiku-4-5-20251001 Anthropic Claude Haiku 4.5是Anthropic于2025年10月发布的Claude 4家族中具有接近前沿智能的最快模型，在保持高效性能的同时特别适合日常使用。 该模型在复杂推理、创意生成和技术问题处理上表现卓越，支持文本生成、代码编写、数据分析和网络搜索等多模态功能。它能够创建交互式React组件、可视化应用、SVG图形和完整的HTML应用等多种"工件"。 - 按量计费 anthropic openai 输入 ¥2.4980 / 1M tokens 输出 ¥12.4800 / 1M tokens Lite-Claude分组
claude-opus-4-1-20250805 Anthropic Claude Opus 4.1 是由Anthropic推出的最新旗舰型AI模型，是Opus 4 的直接升级版本，在编程、AI代理任务以及复杂推理方面拥有业界领先的能力。该模型具备高级的编程技能，能够自主规划并执行端到端的软件开发任务，同时优化了前端代码生成能力，并擅长处理复杂的长期任务和多步骤操作。Opus 4.1 在SWE-bench 基准测试中取得了行业领先的74.5%成绩，证明其在现实世界编程场景中的卓越表现。 - 按量计费 anthropic openai 输入 ¥61.1710 / 1M tokens 输出 ¥305.8550 / 1M tokens default(pro)分组
claude-opus-4-20250514 Anthropic Claude Opus 4是由Anthropic推出的一款旗舰级AI模型，是Anthropic迄今为止最先进的模型，在编程和智能代理领域处于行业领先地位。它专注于处理复杂、多步骤的开发任务，能够进行深度推理、长期规划和高效执行，并且具备强大的多模态能力和长期上下文记忆。此外，Opus 4在软件工程基准测试中表现出色，能生成高质量代码并能辅助进行软件项目的重构和开发。 - 按量计费 anthropic openai 输入 ¥37.4370 / 1M tokens 输出 ¥187.1830 / 1M tokens Lite-Claude分组
claude-opus-4-5-20251101 Anthropic Claude Opus 4.5 是 Anthropic 在2025年11月发布的旗舰级 Opus 系列模型，针对高级工程、复杂 Agent 工作流和企业级办公自动化做了显著优化。 - 按量计费 anthropic openai 输入 ¥12.4810 / 1M tokens 输出 ¥62.3930 / 1M tokens Lite-Claude分组
claude-sonnet-4-20250514 Anthropic Claude Sonnet 4 是Anthropic 推出的最新一代大语言模型，属于Claude 4 系列，它在性能、成本和速度之间取得了平衡，特别适合高吞吐量的日常开发任务和许多企业级自动化应用。Sonnet 4 支持两种推理模式，能够执行代码审查、错误修复、内容创作、数据分析等多种任务。 - 按量计费 anthropic openai 输入 ¥7.4860 / 1M tokens 输出 ¥37.4370 / 1M tokens Lite-Claude分组
claude-sonnet-4-5-20250929 Anthropic Claude Sonnet 4.5是Anthropic于2025年9月发布的Claude 4家族中最智能的模型，在保持高效性能的同时特别适合日常使用。 该模型在复杂推理、创意生成和技术问题处理上表现卓越，支持文本生成、代码编写、数据分析和网络搜索等多模态功能。它能够创建交互式React组件、可视化应用、SVG图形和完整的HTML应用等多种"工件"。 - 按量计费 anthropic openai 输入 ¥7.4860 / 1M tokens 输出 ¥37.4370 / 1M tokens Lite-Claude分组
DeepSeek-R1-0528 DeepSeek DeepSeek-R1-0528是DeepSeek团队推出的最新版模型。模型基于 DeepSeek-V3-0324 训练，参数量达660B。该模型通过利用增加的计算资源并在后训练期间引入算法优化机制，显著提高了其推理和推理能力的深度。该模型在各种基准测试评估中表现出出色的性能，包括数学、编程和一般逻辑。它的整体性能现在接近O3和Gemini2.5 Pro等领先机型。 - 按量计费 openai 输入 ¥4.0000 / 1M tokens 输出 ¥16.0000 / 1M tokens default(pro)分组
DeepSeek-R1-Distill-Llama-70B DeepSeek DeepSeek-R1-Distill-Llama-70B是基于Llama架构并经过强化学习和蒸馏优化开发的高性能语言模型。该模型融合了DeepSeek-R1的先进知识蒸馏技术与Llama-70B模型的架构优势。通过知识蒸馏，在保持较小参数规模的同时，具备强大的语言理解和生成能力。 - 按量计费 openai 输入 ¥4.1000 / 1M tokens 输出 ¥4.1000 / 1M tokens default(pro)分组
DeepSeek-R1-Distill-Qwen-32B DeepSeek DeepSeek-R1-Distill-Qwen-32B是通过知识蒸馏技术从DeepSeek-R1模型中提炼出来的小型语言模型。它继承了DeepSeek-R1的推理能力，专注于数学和逻辑推理任务，但体积更小，适合资源受限的环境。 - 按量计费 openai 输入 ¥1.3000 / 1M tokens 输出 ¥1.3000 / 1M tokens default(pro)分组
deepseek-reasoner DeepSeek DeepSeek-R1 是一款高性能的 MoE （混合专家模型），具备 671B 参数和 37B 激活参数，上下文长度 32K，在百科知识、长文本处理、代码生成、数学解题和中文能力等多个领域表现卓越，超越众多开源模型，并与顶尖闭源模型如 GPT-4o 和 Claude-3.5-Sonnet 相媲美。 - 按量计费 openai 输入 ¥0.8800 / 1M tokens 输出 ¥1.3200 / 1M tokens default(pro)分组
deepseek-v3 DeepSeek DeepSeek-V3是DeepSeek团队开发的新一代专家混合（MoE）语言模型，共有671B参数，在14.8万亿个Tokens上进行预训练。该模型采用多头潜在注意力（MLA）和DeepSeekMoE架构，继承了DeepSeek-V2模型的优势，并在性能、效率和功能上进行了显著提升。 - 按量计费 openai 输入 ¥2.0000 / 1M tokens 输出 ¥3.0000 / 1M tokens default(pro)分组
DeepSeek-V3-0324 DeepSeek DeepSeek-V3-0324是DeepSeek团队于2025年3月24日发布的DeepSeek-V3语言模型的新版本。是一个专家混合（MoE）语言模型，总参数为6710亿个，每个Token激活了370亿个参数。0324版本开创了一种用于负载均衡的辅助无损策略，并设定了多令牌预测训练目标以提高性能。该模型版本在几个关键方面比其前身DeepSeek-V3有了显著改进。 - 按量计费 openai 输入 ¥2.0000 / 1M tokens 输出 ¥8.0000 / 1M tokens default(pro)分组
DeepSeek-V3.1 DeepSeek DeepSeek-V3.1是一个支持思考模式和非思考模式的混合模型。是在 DeepSeek-V3.1-Base 的基础上进行后训练得到的，后者是通过两阶段长上下文扩展方法在原始 V3 基础检查点上构建的，遵循了原始 DeepSeek-V3 报告中概述的方法。通过收集额外的长文档并大幅扩展两个训练阶段来扩大的数据集。 - 按量计费 openai 输入 ¥4.0000 / 1M tokens 输出 ¥16.0000 / 1M tokens default(pro)分组
deepseek-v3.2 DeepSeek 在推理、前端开发、中文写作、中文搜索及函数调用等关键领域，性能、质量与准确性均实现显著提升。 - 按量计费 openai 输入 ¥2.0000 / 1M tokens 输出 ¥3.0000 / 1M tokens default(pro)分组
deepseek-v4-flash DeepSeek DeepSeek-V4-Flash 是 DeepSeek-V4 系列的轻量高效版本，在保持 1M 超长上下文能力的同时，通过更小的模型参数与激活规模，提供更为快捷、经济的 API 服务。 - 按量计费 openai 输入 ¥1.0000 / 1M tokens 输出 ¥2.0000 / 1M tokens default(pro)分组
deepseek-v4-pro DeepSeek 旗舰级 MoE 大模型，总参1.6T、激活 49B，原生支持百万级超长上下文。依托海量高质量训练数据，具备顶尖数学逻辑、复杂推理、专业代码与长文本深度解析能力，适配高阶科研、复杂办公、深度智能代理等高难度场景。 - 按量计费 openai 输入 ¥3.0000 / 1M tokens 输出 ¥18.0000 / 1M tokens default(pro)分组
doubao-1-5-lite-32k-250115 字节跳动 Doubao1.5-lite在轻量版语言模型中也处于全球一流水平，在综合（MMLU_pro）、推理（BBH）、数学（MATH）、专业知识（GPQA）权威测评指标持平或超越GPT-4omini，Cluade 3.5 Haiku - 按量计费 openai 输入 ¥0.2940 / 1M tokens 输出 ¥0.5880 / 1M tokens default(pro)分组
doubao-1-5-pro-32k-250115 字节跳动 Doubao-1.5-pro 全新一代主力模型，性能全面升级，在知识、代码、推理等方面表现卓越。最大支持 128k 上下文窗口，输出长度支持最大 12k tokens。 - 按量计费 openai 输入 ¥0.7840 / 1M tokens 输出 ¥1.9600 / 1M tokens default(pro)分组
doubao-embedding-vision-250615 字节跳动 Doubao-embedding-vision，新版本Seed-1.6-embedding图文多模态向量化模型全新上线，主要面向图文多模向量检索的使用场景，支持图片输入及中、英双语文本输入，最长 8K 上下文长度。 - 按次计费 openai 模型价格：¥0.500 default(pro)分组
doubao-lite-32k-character-250228 字节跳动 Doubao-lite，拥有极致的响应速度，更好的性价比，为客户不同场景提供更灵活的选择。支持32k上下文窗口的推理和精调。 - 按量计费 openai 输入 ¥0.2940 / 1M tokens 输出 ¥0.5880 / 1M tokens default(pro)分组
doubao-seed-1-6-flash-250828 字节跳动 Doubao-Seed-1.6-flash推理速度极致的多模态深度思考模型，TPOT低至10ms； 同时支持文本和视觉理解，文本理解能力超过上一代lite，视觉理解比肩友商pro系列模型。支持 256k 上下文窗口，输出长度支持最大 16k tokens。 - 按量计费 openai 输入 ¥0.1470 / 1M tokens 输出 ¥1.4700 / 1M tokens default(pro)分组
doubao-seed-1-6-lite-251015 字节跳动 更高性价比，常见任务的最佳选择，支持minimal、low、medium、high 四种reasoning_effort思考深度 - 按量计费 openai 输入 ¥0.2940 / 1M tokens 输出 ¥0.5880 / 1M tokens default(pro)分组
doubao-seed-1-8-251228 字节跳动 Doubao-Seed-1.8 面向多模态 Agent 场景定向优化。Agent 能力上，Tool Use、复杂指令遵循等能力均大幅增强。多模态理解方面，视觉基础能力显著提升，可低帧率理解超长视频，视频运动理解、复杂空间理解及文档结构化解析能力也有所优化，还原生支持智能上下文管理，用户可配置上下文策略。 - 按量计费 openai 输入 ¥0.7840 / 1M tokens 输出 ¥1.9600 / 1M tokens default(pro)分组
doubao-seed-2-0-code-preview-260215 字节跳动 面向真实编程环境优化的 Coding 模型，能稳定调用 Claude Code 等常见 IDE 中的工具。模型特别优化了前端能力，在使用常见的前端框架时能有良好表现。模型支持使用 Skills，可以配合多种自定义技能使用。 - 按量计费 openai 输入 ¥3.1400 / 1M tokens 输出 ¥15.7000 / 1M tokens default(pro)分组
doubao-seed-2-0-lite-260215 字节跳动 面向高频企业场景兼顾性能与成本的均衡型模型，综合能力超越上一代Doubao-Seed-1.8。胜任非结构化信息处理、内容创作、搜索推荐、数据分析等生产型工作，支持长上下文、多源信息融合、多步指令执行与高保真结构化输出。在保障稳定效果的同时显著优化成本。 - 按量计费 openai 输入 ¥0.5800 / 1M tokens 输出 ¥3.4800 / 1M tokens default(pro)分组
doubao-seed-2-0-mini-260215 字节跳动 面向低时延、高并发与成本敏感场景，提供极致的模型推理速度。模型效果与Doubao-Seed-1.6相当。支持256k上下文、4档思考长度和多模态理解，适合成本和速度优先的轻量级任务。 - 按量计费 openai 输入 ¥0.1960 / 1M tokens 输出 ¥1.9600 / 1M tokens default(pro)分组
doubao-seed-2-0-pro-260215 字节跳动 旗舰级全能通用模型，面向 Agent 时代的复杂推理与长链路任务执行场景。强调多模态理解、长上下文推理、结构化生成与工具增强执行。复杂指令与多约束执行能力突出，可稳定应对多步复杂规划、复杂图文推理、视频内容理解与高难度分析等场景。 - 按量计费 openai 输入 ¥3.1400 / 1M tokens 输出 ¥15.7000 / 1M tokens default(pro)分组
doubao-seed-code-preview-251028 字节跳动 面向Agentic编程任务进行了深度优化，在Terminal Bench、SWE-Bench-Verified-Openhands、Multi-SWE-Bench-Flash-Openhands等多项权威基准测试中表现优异 - 按量计费 openai 输入 ¥1.1760 / 1M tokens 输出 ¥7.8400 / 1M tokens default(pro)分组
doubao-seed-translation-250915 字节跳动 通用多语言翻译模型，支持30余种语言互译，支持 4K 上下文窗口，输出长度支持最大 3K tokens - 按量计费 openai 输入 ¥1.1760 / 1M tokens 输出 ¥3.5280 / 1M tokens default(pro)分组
gemini-2.0-flash Gemini Gemini 2.0 Flash 是 Google DeepMind 推出的第二代 “Flash” 级别通用模型，专为高速、多模态、工具调用场景而设计。 该模型拥有高达 100 万 token 的上下文窗口，支持文本、图像、音频、视频作为输入，并具备函数调用、地理定位等原生工具使用能力。 它在推理速度与资源效率方面较前代大幅提升，构建了“代理化（agentic）时代”的基础架构。 - 按量计费 gemini openai 输入 ¥0.5940 / 1M tokens 输出 ¥2.3870 / 1M tokens default(pro)分组
gemini-2.5-flash Gemini Gemini 2.5 Flash 是谷歌于2025年发布的轻量化高速AI模型，作为旗舰模型Gemini 2.5 Pro的补充，它旨在以极致的速度和更低的成本提供强大的性能。其核心亮点在于实现了性能与效率的最佳平衡，不仅拥有增强的多模态处理能力和高达200万Token的超长上下文窗口，还专为实时聊天、高频内容分析和工具使用复杂任务等需要即时响应和高吞吐量的应用场景进行了深度优化。 - 按量计费 gemini openai 输入 ¥0.8230 / 1M tokens 输出 ¥6.8410 / 1M tokens Lite-gemini分组
gemini-2.5-pro Gemini 2025年初发布的Gemini 2.5 Pro是谷歌在人工智能领域的一大突破。该模型在继承其系列多模态能力的基础上，显著提升了推理深度、上下文处理能力和任务适应性。其核心特性包括：比肩人类的“思维”能力，支持高达100万token的超长上下文窗口（可处理超700页文本），以及顶尖的多模态理解能力，能同时处理文字、图像、视频和音频。在与GPT-4o等主流模型的对比中，Gemini 2.5 Pro在推理能力和多模态支持上表现突出，尤其适用于复杂的代码开发、深度内容分析和智能对话系统等场景。 - 按量计费 gemini openai 输入 ¥3.4180 / 1M tokens 输出 ¥27.3590 / 1M tokens Lite-gemini分组
gemini-3-flash-preview Gemini Gemini 3 Flash 是 Google 推出的新一代通用 AI 模型版本，结合了 Gemini 3 Pro 的推理与多模态理解能力与 Flash 系列 的低延迟、高效率和低成本特性，支持大上下文、多模态输入，适合开发者代理式工作流、日常智能问答与快速分析等场景 - 按量计费 gemini openai 输入 ¥1.3680 / 1M tokens 输出 ¥8.2100 / 1M tokens Lite-gemini分组
gemini-embedding-001 Gemini Gemini API 提供文本嵌入模型，用于为字词、短语、句子和代码生成嵌入。嵌入任务，例如语义搜索、分类和聚类，可提供比基于关键字的方法更准确、更贴合情境的结果。 - 按量计费 gemini openai 输入 ¥0.9000 / 1M tokens 输出 ¥3.6000 / 1M tokens default(pro)分组
gemini-embedding-2-preview Gemini 最新模型 gemini-embedding-2-preview 是 Gemini API 中的首个多模态嵌入模型。它将文本、图片、视频、音频和文档映射到统一的嵌入空间中，从而能够以 100 多种语言进行跨模态搜索、分类和聚类。 - 按量计费 gemini openai 输入 ¥1.2000 / 1M tokens 输出 ¥4.8000 / 1M tokens default(pro)分组
GLM-5 智谱 GLM-5 是由智谱 AI（源自清华大学计算机系知识工程实验室 KEG）推出的下一代前沿大语言模型。它采用了独特的 GLM（通用语言模型）架构，在原生中文语义理解和跨语言逻辑一致性方面表现卓越。第 5 代版本专注于“全频谱智能”，在复杂的工业自动化、企业级 API 集成以及科学知识检索中展现出强大的性能。对于本土化中文 AI 应用和高要求商业逻辑场景，它依然是最可靠的选择之一。 - 按量计费 openai 输入 ¥4.0000 / 1M tokens 输出 ¥18.0000 / 1M tokens default(pro)分组
glm-5.1 智谱 GLM-5.1 是智谱最新旗舰模型，代码能力大大增强，长程任务显著提升，能够在单次任务中持续、自主地工作长达 8 小时，完成从规划、执行到迭代优化的完整闭环，交付工程级成果。 在综合能力与 Coding 能力上，GLM-5.1 整体表现对齐 Claude Opus 4.6，并在长程自主执行、复杂工程优化与真实开发场景中展现出更强的持续工作能力，是构建 Autonomous Agent 与长程 Coding Agent 的理想基座。 - 按量计费 openai 输入 ¥6.0000 / 1M tokens 输出 ¥24.0000 / 1M tokens default(pro)分组
GPT-4.1 OpenAI GPT-4.1是OpenAI在2025年4月发布的GPT大型语言模型系列，专为开发者和企业用户设计，主要亮点是支持高达100万tokens的长上下文窗口，显著提升了代码生成和指令遵循的能力，同时比GPT-4o降低了成本。 - 按量计费 openai 输入 ¥5.1610 / 1M tokens 输出 ¥20.6450 / 1M tokens Lite-GPT分组
GPT-4o OpenAI GPT-4o是OpenAI发布的最新旗舰级多模态大语言模型，能同时处理文本、音频、图像和视频，并快速生成任意组合的输出，其速度更快、成本更低，在多语言、视觉和音频理解方面性能优异，在自然人机交互方面实现重大进步。 - 按量计费 openai 输入 ¥6.4030 / 1M tokens 输出 ¥25.5990 / 1M tokens Lite-GPT分组
grok-4-1-fast-non-reasoning Grok (xAI) grok-4-1-fast-non-reasoning是xAI开发的一款 AI 模型，专为在生成响应和执行代理任务时实现最大速度而优化。与它的“推理”对应版本不同，这一变体省去了使用“思考标记”的过程，从而能够针对简单、直白的查询立即提供模式匹配式的答案。 - 按量计费 openai 输入 ¥0.8000 / 1M tokens 输出 ¥2.0000 / 1M tokens default(pro)分组
grok-4-1-fast-reasoning Grok (xAI) Grok 4.1 Fast 是xAI旗下的一款顶尖工具调用模型，拥有 200 万个上下文窗口。它能够以准确且高效的方式推理并执行代理式任务，尤其擅长处理复杂的现实应用场景，如客户支持和金融领域。为充分发挥其最大智能潜力而进行优化。 - 按量计费 openai 输入 ¥0.8000 / 1M tokens 输出 ¥2.0000 / 1M tokens default(pro)分组
grok-4-20-non-reasoning Grok (xAI) Grok 4.20 是xai最新的旗舰型号，具备行业领先的速度和代理工具调用能力。它结合了市场上最低的幻觉率和严格的及时依从，始终提供准确且真实的回复。 - 按量计费 openai 输入 ¥8.0000 / 1M tokens 输出 ¥24.0000 / 1M tokens default(pro)分组
grok-4-20-reasoning Grok (xAI) Grok 4.20 是xai最新的旗舰型号，具备行业领先的速度和代理工具调用能力。它结合了市场上最低的幻觉率和严格的及时依从，始终提供准确且真实的回复。 - 按量计费 openai 输入 ¥8.0000 / 1M tokens 输出 ¥24.0000 / 1M tokens default(pro)分组
hy3-preview 混元 混元 Hy3 preview 面向 Agent 工作负载设计，采用 295B/21B 激活的 MoE 架构。在同一个模型内提供 no_think（极速响应）、think_low（快速思考）、think_high（深度推理）三档模式，适配从高频交互到复杂工程任务的不同延迟与深度需求。在 SWE-bench Verified 等代码基准上接近当前最强水平，256K 上下文支持跨文件代码重构与长文档分析。适合需要可靠任务完成度、同时对推理成本敏感的开发者。 - 按量计费 openai 输入 ¥1.2000 / 1M tokens 输出 ¥4.8000 / 1M tokens default(pro)分组
kimi-k2.6 L 月之暗面 - - 按量计费 openai 输入 ¥6.5000 / 1M tokens 输出 ¥26.9750 / 1M tokens default(pro)分组
kimi/kimi-k2.5 L 月之暗面 - - 按量计费 openai 输入 ¥4.0000 / 1M tokens 输出 ¥21.0000 / 1M tokens default(pro)分组
MiniMax-M2.5 MiniMax MiniMax-M2.5是MiniMax推出的旗舰级开源大模型，经过数十万个真实复杂环境中的大规模强化学习训练，M2.5 在编程、工具调用和搜索、办公等生产力场景都达到或者刷新了行业的 SOTA。 - 按量计费 openai 输入 ¥2.1000 / 1M tokens 输出 ¥8.4000 / 1M tokens default(pro)分组
MiniMax/MiniMax-M2.7 MiniMax M2.7 能够自行构建复杂 Agent Harness，并基于 Agent Teams、复杂 Skills、Tool Search tool 等能力，完成高度复杂的生产力任务。 - 按量计费 openai 输入 ¥2.1000 / 1M tokens 输出 ¥8.4000 / 1M tokens default(pro)分组
o4-mini OpenAI - - 按量计费 openai 输入 ¥0.5500 / 1M tokens 输出 ¥0.5500 / 1M tokens default(pro)分组
qwen-flash 阿里巴巴 Qwen3系列Flash模型，实现思考模式和非思考模式的有效融合，可在对话中切换模式。复杂推理类任务性能优秀，指令遵循、文本理解等能力显著提高。支持1M上下文长度，按照上下文长度进行阶梯计费。 - 按量计费 openai 输入 ¥0.1500 / 1M tokens 输出 ¥1.5000 / 1M tokens default(pro)分组
qwen-max 阿里巴巴 千问2.5系列千亿级别超大规模语言模型，支持中文、英文等不同语言输入。随着模型的升级，qwen-max将滚动更新升级。如果希望使用固定版本，请使用历史快照版本。 - 按量计费 openai 输入 ¥2.4000 / 1M tokens 输出 ¥9.6000 / 1M tokens default(pro)分组
qwen-plus 阿里巴巴 Qwen3系列Plus模型，实现思考模式和非思考模式的有效融合，可在对话中切换模式。推理能力显著超过QwQ、通用能力显著超过Qwen2.5-Plus，达到同规模业界SOTA水平。 - 按量计费 openai 输入 ¥0.8000 / 1M tokens 输出 ¥2.0000 / 1M tokens default(pro)分组
qwen3-235b-a22b 阿里巴巴 Qwen3-235B-A22B是Qwen3系列大型语言模型的旗舰模型。拥有2350多亿总参数和220多亿激活参数。在代码、数学、通用能力等基准测试中，与DeepSeek-R1、o1、o3-mini、Grok-3和Gemini-2.5-Pro等顶级模型相比，表现出极具竞争力的结果。 - 按量计费 openai 输入 ¥2.0000 / 1M tokens 输出 ¥20.0000 / 1M tokens default(pro)分组
Qwen3-235B-A22B-Instruct-2507 阿里巴巴 Qwen3-235B-A22B-Instruct-2507是阿里通义千问发布的开源 MoE 架构大模型，总参数2350 亿、激活220亿参数，在指令遵循、推理、编码等多领域性能突出，覆盖 100 多种语言与长尾知识。 - 按量计费 openai 输入 ¥2.0000 / 1M tokens 输出 ¥8.0000 / 1M tokens default(pro)分组
Qwen3-Coder-480B-A35B-Instruct 阿里巴巴 Qwen3-Coder-480B-A35B-Instruct是阿里通义千问开源的顶尖代码大模型，采用混合专家（MoE）架构，总参 4800 亿、激活 350 亿参数，实现性能与成本的平衡，能处理仓库级代码与跨文件依赖。 - 按量计费 openai 输入 ¥8.0000 / 1M tokens 输出 ¥16.0000 / 1M tokens default(pro)分组
qwen3-max 阿里巴巴 千问3系列Max模型，相较preview版本在智能体编程与工具调用方向进行了专项升级。本次发布的正式版模型达到领域SOTA水平，适配场景更加复杂的智能体需求。 - 按量计费 openai 输入 ¥2.5000 / 1M tokens 输出 ¥10.0000 / 1M tokens default(pro)分组
qwen3-max-2026-01-23 阿里巴巴 千问3系列Max模型，相较2025年9月23日快照，此版本实现思考模式和非思考模式的有效融合，模型整体效果得到全方位的大幅度提升。在思考模式下，同时发布Web搜索、Web信息提取和代码解释器工具能力，使得模型在慢思考的同时，能够通过引入外部工具，以更高的准确性解决更有难度的问题。此版本为2026年1月23日快照。 - 按量计费 openai 输入 ¥2.5000 / 1M tokens 输出 ¥10.0000 / 1M tokens default(pro)分组
qwen3-vl-flash 阿里巴巴 Qwen3系列小尺寸视觉理解模型，实现思考模式和非思考模式的有效融合，效果优于开源版Qwen3-VL-30B-A3B，响应速度快。全面升级图像/视频理解，支持长视频长文档等超长上下文、空间感知与万物识别；具备视觉2D/3D定位能力，胜任复杂现实任务。 - 按量计费 openai 输入 ¥0.1500 / 1M tokens 输出 ¥1.5000 / 1M tokens default(pro)分组
qwen3-vl-plus 阿里巴巴 Qwen3系列视觉理解模型，实现思考模式和非思考模式的有效融合，视觉智能体能力在OS World等公开测试集上达到世界顶尖水平。此版本在视觉coding、空间感知、多模态思考等方向全面升级；视觉感知与识别能力大幅提升，支持超长视频理解。 该模型版本功能等同于快照模型qwen3-vl-plus-2025-12-19 - 按量计费 openai 输入 ¥1.0000 / 1M tokens 输出 ¥10.0000 / 1M tokens default(pro)分组
qwen3.5-35b-a3b 阿里巴巴 Qwen3.5系列35B-A3B原生视觉语言模型，基于混合架构设计，融合了线性注意力机制与稀疏混合专家模型，实现了更高的推理效率。该模型的综合表现接近于Qwen3.5-27B。 - 按量计费 openai 输入 ¥0.4000 / 1M tokens 输出 ¥3.2000 / 1M tokens default(pro)分组
Qwen3.5-397B-A17B-Pro 阿里巴巴 Qwen3.5-397B-A17B 是阿里通义千问团队研发的新一代旗舰级开源多模态 MoE（Mixture of Experts）模型。该模型拥有 3970 亿总参数，但在推理时仅激活 170 亿参数（A17B），实现了极致的性能与效率平衡。Qwen3.5 采用了创新的“门控 DeltaNet + MoE”混合架构，实现了视觉与语言的早期融合训练。它不仅在推理、编码和多语言理解上跨代际超越了前代 - 按量计费 openai 输入 ¥3.0000 / 1M tokens 输出 ¥18.0000 / 1M tokens default(pro)分组
qwen3.5-flash 阿里巴巴 Qwen3.5原生视觉语言系列Flash模型，基于混合架构设计，融合了线性注意力机制与稀疏混合专家模型，实现了更高的推理效率。模型效果在纯文本与多模态方面相较3系列均实现飞跃式进步；响应速度快，兼具推理速度和性能。 - 按量计费 openai 输入 ¥0.2000 / 1M tokens 输出 ¥2.0000 / 1M tokens default(pro)分组
qwen3.5-plus 阿里巴巴 Qwen3.5原生视觉语言系列Plus模型，基于混合架构设计，融合了线性注意力机制与稀疏混合专家模型，实现了更高的推理效率。在多项任务评测中，3.5系列均展现出与当前顶尖前沿模型相媲美的卓越性能，模型效果在纯文本与多模态方面相较3系列均实现飞跃式进步。 该模型版本功能等同于快照模型qwen3.5-plus-2026-02-15 - 按量计费 openai 输入 ¥0.8000 / 1M tokens 输出 ¥4.8000 / 1M tokens default(pro)分组
qwen3.6-flash 阿里巴巴 - - 按量计费 openai 输入 ¥1.2000 / 1M tokens 输出 ¥7.2000 / 1M tokens default(pro)分组
qwen3.6-max-preview 阿里巴巴 - - 按量计费 openai 输入 ¥9.0000 / 1M tokens 输出 ¥54.0000 / 1M tokens default(pro)分组
qwen3.6-plus 阿里巴巴 Qwen3.6原生视觉语言系列Plus模型，展现出与当前顶尖前沿模型相媲美的卓越性能，模型效果相较3.5系列显著提升。模型在Agentic coding、前端编程、Vibe coding等代码能力、多模态万物识别、OCR、物体定位等能力上显著增强。 - 按量计费 openai 输入 ¥2.0000 / 1M tokens 输出 ¥12.0000 / 1M tokens default(pro)分组
siliconflow/deepseek-r1-0528 DeepSeek DeepSeek-V3.2 是一款实现了高计算效率与卓越推理及代理（Agent）性能完美协调的模型。该模型建立在 DeepSeek-V3 的基础之上，通过引入 DeepSeek 稀疏注意力（DSA）、可扩展的强化学习框架以及大规模代理任务合成流水线等关键技术突破，推动了开源大语言模型的前沿发展。 - 按量计费 openai 输入 ¥4.0000 / 1M tokens 输出 ¥16.0000 / 1M tokens default(pro)分组
text-embedding-v2 阿里巴巴 通用文本向量，是通义实验室基于LLM底座的多语言文本统一向量模型，面向全球多个主流语种，提供高水准的向量服务，帮助开发者将文本数据快速转换为高质量的向量数据。 - 按量计费 openai 输入 ¥0.7000 / 1M tokens 输出 ¥0.7000 / 1M tokens default(pro)分组
text-embedding-v4 阿里巴巴 是通义实验室基于Qwen3训练的多语言文本统一向量模型，相较V3版本在文本检索、聚类、分类性能大幅提升；在MTEB多语言、中英、Code检索等评测任务上效果提升15%~40%；支持64~2048维用户自定义向量维度。 - 按量计费 openai 输入 ¥0.5000 / 1M tokens 输出 ¥0.5000 / 1M tokens default(pro)分组
vanchin/deepseek-v3.2-think DeepSeek DeepSeek-R1-0528 是一款强化学习（RL）驱动的推理模型，解决了模型中的重复性和可读性问题。在 RL 之前，DeepSeek-R1 引入了冷启动数据，进一步优化了推理性能。它在数学、代码和推理任务中与 OpenAI-o1 表现相当，并且通过精心设计的训练方法，提升了整体效果。 - 按量计费 openai 输入 ¥2.0000 / 1M tokens 输出 ¥3.0000 / 1M tokens default(pro)分组
```

## 图片生成模型 (image)

```
模型名称 供应商 描述 标签 计费类型 可用端点类型 模型价格
doubao-seedream-4-5-251128 字节跳动 Seedream 4.5 是字节跳动最新自主研发的图像生成大模型。该模型相较于 4.0 实现了全面提升，尤其在编辑一致性（如主体细节与光影色调的保持）、人像美化和小字生成方面体验升级。 - 按次计费 image-generation openai 模型价格：¥0.245 default(pro)分组
doubao-seedream-5-0-260128 字节跳动 Doubao-Seedream-5.0-lite是字节跳动发布的最新图像创作模型。该模型首次搭载联网检索功能，能融合实时网络信息，提升生图时效性。同时，模型的聪明度进一步升级，能够精准解析复杂指令和视觉内容。此外，模型在世界知识广度、参考一致性及专业场景生成质量上均有增强，可更好地满足企业级视觉创作需求。 - 按次计费 image-generation 模型价格：¥0.220 default(pro)分组
gemini-3-pro-image-preview Gemini Gemini-3-Pro-Image-Preview 是 Google 提供的多模态图像生成模型，支持文本与多图输入，具备高分辨率图像生成、复杂场景理解与多轮编辑能力，适用于内容生产、视觉创意与企业级图像生成场景。 - 按量计费 image-generation gemini openai 输入 ¥4.7680 / 1M tokens 输出 ¥286.0180 / 1M tokens Lite-banana-pro(gemini-3-pro-image-preview)特惠分组
gemini-3.1-flash-image-preview Gemini Gemini-3.1-Flash-Image-Preview 是 Google 旗舰级多模态图像生成模型的高速预览版本，兼顾快速响应与高质量视觉输出，适用于集成式图像创作与智能视觉工作流。 - 按量计费 image-generation gemini openai 输入 ¥0.5960 / 1M tokens 输出 ¥143.5350 / 1M tokens Lite-banana2(gemini-3.1-flash-image-preview)特惠分组
gpt-image-2 OpenAI GPT-image-2 是 OpenAI 最新的尖端图像生成模型。主要价值包括更好的性能、质量、编辑控制和面部保留。 - 按量计费 openai 输入 ¥50.4000 / 1M tokens 输出 ¥189.0000 / 1M tokens default(pro)分组
doubao-seedream-3-0-t2i-250415 字节跳动 Seedream 3.0 是一款支持原生高分辨率的中英双语图像生成基础模型，综合能力媲美GPT-4o，处于世界第一梯队。支持原生 2K 分辨率输出；响应速度更快；小字生成更准确，文本排版效果增强；指令遵循能力强，美感&结构提升，保真度和细节表现较好。 - 按次计费 image-generation openai 模型价格：¥0.250 default(pro)分组
doubao-seedream-3-0-t2i-250415i 字节跳动 Seedream 3.0 是一款支持原生高分辨率的中英双语图像生成基础模型，由字节跳动豆包大模型团队自主研发。Seedream 3.0 的综合能力显著增强：支持原生 2K 分辨率输出；响应速度更快；小字生成更准确，文本排版效果增强；指令遵循能力强，美感、结构提升，保真度和细节表现较好，在多项评估中排名领先。能够应用于更复杂、更广泛的图片生成场景。 - 按次计费 image-generation openai 模型价格：¥0.254 default(pro)分组
doubao-seedream-4-0-250828 字节跳动 Seedream 4.0 是基于领先架构的SOTA级多模态图像创作模型。其打破传统文生图模型的创作边界，原生支持文本、单图和多图输入，用户可自由融合文本与图像，在同一模型下实现基于主体一致性的多图融合创作、图像编辑、组图生成等多样玩法，让图像创作更加自由可控 - 按次计费 image-generation openai 模型价格：¥0.200 default(pro)分组
FLUX.2-dev OpenAI Flux.2旨在通过先进的AI技术，从文本提示生成视觉震撼、上下文准确的图像。其开发团队源自Stable Diffusion的核心成员，因Stability AI内部问题后独立成立Black Forest Labs，致力于突破图像生成的极限。 - 按次计费 image-generation openai 模型价格：¥0.022 default(pro)分组
MiniMax-Hailuo-image-01 MiniMax - - 按次计费 openai 模型价格：¥0.050 default(pro)分组
MiniMax-Hailuo-image-01-live MiniMax - - 按次计费 openai 模型价格：¥0.050 default(pro)分组
Z-Image-Turbo 阿里巴巴 Z-Image 是一款轻量级文生图模型，可快速生成图像，支持中英文字渲染，并灵活适配多种分辨率与宽高比例。 - 按次计费 image-generation openai 模型价格：¥0.200 default(pro)分组
```

## 视频生成模型 (video)

```
模型名称 供应商 描述 标签 计费类型 可用端点类型 模型价格
doubao-seedance-1-5-pro-251215 字节跳动 豆包视频生成模型Seedance 1.5 pro 作为全球领先的视频生成模型，可生成音画高精同步的视频内容。支持多人多语言对白，全面覆盖环境音、动作音、合成音、乐器音、背景音及人声，支持首尾帧，实现影视级叙事效果，满足影视、漫剧、电商及广告领域的高阶创作需求 - 按量计费 video 输入 ¥15.7000 / 1M tokens 输出 ¥15.7000 / 1M tokens default(pro)分组
doubao-seedance-1-0-lite-i2v-250428 字节跳动 Doubao-Seedance-1.0-lite-i2v，根据首帧图片、尾帧图片（可选）、参考图片（可选）和文本描述（可选）生成视频。是兼顾生成效果与速度的性价比之选。该模型语义理解与指令遵循能力强。运镜专业。支持多种视频风格，可以丝滑兼容各种风格的首图。分辨率支持480P、720P、1080P，时长支持2-12s，帧率24fps - 按量计费 video 输入 ¥4.1200 / 1M tokens 输出 ¥4.1200 / 1M tokens default(pro)分组
doubao-seedance-1-0-pro-250528 字节跳动 Seedance 1.0 Pro是一款支持多镜头叙事的视频生成基础模型，在各维度表现出色。它在语义理解与指令遵循能力上取得突破，能生成运动流畅、细节丰富、风格多样且具备影视级美感的 1080P 高清视频 - 按量计费 video 输入 ¥15.0000 / 1M tokens 输出 ¥15.0000 / 1M tokens default(pro)分组
doubao-seedance-1-0-pro-fast-251015 字节跳动 Seedance 1.0 pro fast是一款价格触底、效能封顶的全面模型，在视频生成质量、速度、价格之间取得了卓越平衡。它继承了Seedance 1.0 pro 核心优势，同时生成速度提升、价格更具竞争力，为创作者带来效率与成本双重优化的体验 - 按量计费 video 输入 ¥4.2000 / 1M tokens 输出 ¥4.2000 / 1M tokens default(pro)分组
doubao-seedance-2-0-260128 字节跳动 - - 按量计费 video 输入 ¥51.0000 / 1M tokens 输出 ¥51.0000 / 1M tokens default(pro)分组
doubao-seedance-2-0-fast-260128 字节跳动 - - 按量计费 video 输入 ¥37.0000 / 1M tokens 输出 ¥37.0000 / 1M tokens default(pro)分组
happyhorse-1.0-i2v 阿里巴巴 HappyHorse-1.0-I2V支持文生视频，具备高度还原的动态画面生成能力，能够精准理解文本语义，输出流畅自然、细节丰富的高质量视频。 - 按秒计费 openai ¥1.600 / 秒 default(pro)分组
happyhorse-1.0-r2v 阿里巴巴 HappyHorse-1.0-R2V支持参考生视频，更加稳定的主体与场景参考，支持最多9张图片参考，能够精准保持创作意图，实现更强表现能力。 - 按秒计费 openai ¥1.600 / 秒 default(pro)分组
happyhorse-1.0-t2v 阿里巴巴 HappyHorse-1.0-T2V支持文生视频，具备高度还原的动态画面生成能力，能够精准理解文本语义，输出流畅自然、细节丰富的高质量视频。 - 按秒计费 openai ¥1.600 / 秒 default(pro)分组
happyhorse-1.0-video-edit 阿里巴巴 HappyHorse-1.0-Video-Edit支持视频编辑，自然语言指令编辑视频，可参考最多5张图片局部或全局编辑视频元素，能够精准复刻视频动态过程，实现更强表现能力。 - 按秒计费 openai ¥1.600 / 秒 default(pro)分组
jimeng_i2v_first_tail_v30_1080 即梦 即梦AI-视频生成3.0 1080P-图生视频-首尾帧 - 按秒计费 video ¥0.200 / 秒 default(pro)分组
jimeng_i2v_first_v30 即梦 即梦AI-视频生成3.0 720P-图生视频-首帧 - 按秒计费 video ¥0.200 / 秒 default(pro)分组
jimeng_i2v_recamera_v30 即梦 即梦AI-视频生成3.0 720P-图生视频-运镜 - 按秒计费 video ¥0.200 / 秒 default(pro)分组
jimeng_t2v_v30 即梦 即梦AI-视频生成3.0 720P - 按秒计费 video ¥0.200 / 秒 default(pro)分组
jimeng_t2v_v30_1080p 即梦 即梦AI-视频生成3.0 1080P-图生视频-首帧 - 按秒计费 video ¥0.450 / 秒 default(pro)分组
jimeng_ti2v_v30_pro 即梦 即梦AI-视频生成3.0 Pro - 按秒计费 video ¥0.715 / 秒 default(pro)分组
kling-v1 快手 kling-v1 多模态模型，支持质视频生成（标准/高品质），多图参考生成视频（标准/高品质），多模态视频编辑（标准/高品质）、视频延长（标准/高品质） - 按秒计费 video ¥0.755 / 秒 default(pro)分组
kling-v1-5 快手 kling-v1-5多模态模型，支持标准/高品质视频生成，以及文生图/图生图能力 - 按秒计费 video ¥0.755 / 秒 default(pro)分组
kling-v1-6 快手 Kling-v1-6（可灵 1.6）是快手推出的 AI 视频生成模型，支持文生视频与图生视频，在人物一致性、动作连贯性与画面稳定性上较前代明显提升，适用于短视频与创意内容生成场景。 - 按秒计费 video ¥0.755 / 秒 default(pro)分组
kling-v2 快手 图片V2.0模型 - 按秒计费 video ¥0.108 / 秒 default(pro)分组
kling-v2-1 快手 Kling-v2-1（可灵 2.1）是快手推出的 AI 视频生成模型，支持图生视频/文生视频，主打更强的运动真实感与画面一致性，并提供标准（720p）与高品质（1080p）等档位，兼顾生成速度与性价比。 - 按秒计费 video ¥0.755 / 秒 default(pro)分组
kling-v2-1-master 快手 视频V2.1大师版模型 - 按秒计费 video ¥2.156 / 秒 default(pro)分组
kling-v2-5-turbo 快手 视频V2.5 turbo模型，包含标准和高品质 - 按秒计费 video ¥0.539 / 秒 default(pro)分组
kling-v2-6 快手 可灵首个音画同出模型。实现单次生成同时产出画面 + 自然语音 + 匹配音效 + 环境氛围。打通“音”、“画”两个世界。 - 按秒计费 video ¥1.200 / 秒 default(pro)分组
kling-v2-master 快手 视频V2.0大师版模型 - 按秒计费 video ¥2.156 / 秒 default(pro)分组
kling-v2-new 快手 【图片V2.0-new模型】图生图 - 按次计费 video 模型价格：¥0.216 default(pro)分组
kling-video-o1 快手 统一AI视频模型和创意引擎。该模型提供导演级每帧控制，统一处理文本、图像和视频输入，支持用户以更高一致性和控制能力生成编辑视频 - 按量计费 video 输入 ¥37.5000 / 1M tokens 输出 ¥37.5000 / 1M tokens default(pro)分组
veo-3 L Google Veo 3是 Google DeepMind 推出的旗舰级多模态模型。它实现了从“无声短片”到“有声叙事”的跨越，能够通过单次推理同步生成高清视频与匹配的高保真音轨。 - 按秒计费 video ¥3.260 / 秒 default(pro)分组
veo-3-fast L Google Veo 3是 Google 推出的尖端生成式视频模型，旨在将 AI 创作从单一视觉呈现提升至叙事驱动 (Narrative-driven) 的影视级水准。该模型不仅能输出极具冲击力的 1080P/4K 视觉画面，更实现了原生音频同步生成。通过单次推理，Veo 3.1 即可同步合成包含角色对白 (Dialogue)、环境氛围音 (Ambient Noise)、特效音 (SFX) 及背景音乐在内的完整音轨，确保音画精准对齐，为开发者提供真正“一键成片”的专业级素材。 - 按秒计费 video ¥3.260 / 秒 default(pro)分组
veo-3.1 L Google Veo 3.1 是 Google 推出的尖端生成式视频模型，旨在将 AI 创作从单一视觉呈现提升至叙事驱动 (Narrative-driven) 的影视级水准。该模型不仅能输出极具冲击力的 1080P/4K 视觉画面，更实现了原生音频同步生成。通过单次推理，Veo 3.1 即可同步合成包含角色对白 (Dialogue)、环境氛围音 (Ambient Noise)、特效音 (SFX) 及背景音乐在内的完整音轨，确保音画精准对齐，为开发者提供真正“一键成片”的专业级素材。 - 按秒计费 video ¥4.280 / 秒 default(pro)分组
veo-3.1-fast L Google Veo 3.1 是 Google 推出的尖端生成式视频模型，旨在将 AI 创作从单一视觉呈现提升至叙事驱动 (Narrative-driven) 的影视级水准。该模型不仅能输出极具冲击力的 1080P/4K 视觉画面，更实现了原生音频同步生成。通过单次推理，Veo 3.1 即可同步合成包含角色对白 (Dialogue)、环境氛围音 (Ambient Noise)、特效音 (SFX) 及背景音乐在内的完整音轨，确保音画精准对齐，为开发者提供真正“一键成片”的专业级素材。 - 按秒计费 video ¥2.140 / 秒 default(pro)分组
wan2.5-i2v-preview 阿里巴巴 - - 按秒计费 video ¥1.100 / 秒 default(pro)分组
wan2.5-t2v-preview 阿里巴巴 - - 按秒计费 video ¥1.100 / 秒 default(pro)分组
wan2.6-i2v 阿里巴巴 - - 按秒计费 video ¥1.100 / 秒 default(pro)分组
wan2.6-t2v 阿里巴巴 - - 按秒计费 video ¥1.100 / 秒 default(pro)分组
```
