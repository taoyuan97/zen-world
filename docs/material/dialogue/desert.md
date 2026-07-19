# 无尘 · 寂静沙漠对话剧本（定稿）

- 决策 D4：2~4 轮 + 1 组选项 + `start_meditation` 收尾；无尘口吻：极简，一两句即止
- 对应数据：`src/data/dialogues/desert.json`

## 流程

1. **greeting**：你来了。这里没什么可看的。够了。 → q1
2. **q1（选项）**：放下一样东西。是什么？
   - 选项 A「放不下的念头」→ r1
   - 选项 B「攒了很久的疲惫」→ r2
3. **r1**：念头握在手里是东西。放下，就是沙。 → invite
4. **r2**：沙不喊累。空了，就不累了。 → invite
5. **invite**：坐。看日落。什么都不用做。 → action: `start_meditation`

## 完成页赠言（blessing）

> 你留下的空，沙会替你守着。
