import { join } from 'node:path';
import { tradeMasterHome, writeJson, writeMarkdown } from './storage.js';
function safeName(value) {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'report';
}
function table(rows, columns) {
    if (rows.length === 0)
        return ['暂无。'];
    const display = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${columns.map((column) => display(row[column])).join(' | ')} |`),
    ];
}
export function renderMarkdown(title, value) {
    const lines = [`# ${title}`, '', `- 生成时间：${String(value.generated_at ?? new Date().toISOString())}`];
    if (value.as_of)
        lines.push(`- 数据截止：${String(value.as_of)}`);
    lines.push('');
    const conclusion = value.conclusion;
    if (conclusion) {
        lines.push('## 结论', '', `- 动作：${String(conclusion.action ?? '')}`, `- 摘要：${String(conclusion.summary ?? '')}`, '');
    }
    const replay = value.replay;
    if (replay)
        lines.push('## 回放口径', '', `- 标的：${String(replay.name ?? '')}（${String(replay.code ?? '')}）`, `- 截止：${String(replay.as_of ?? '')}`, `- 无未来数据：${String(replay.no_lookahead ?? false)}`, '');
    const points = value.confirmed_points;
    if (points)
        lines.push('## 确认买卖点', '', ...table(points.map((item) => ({ time: item.time, side: item.side, strategy: item.strategy, period: item.period, price: item.price, confidence: item.confidence })), ['time', 'side', 'strategy', 'period', 'price', 'confidence']), '');
    const candidates = value.candidates;
    if (candidates)
        lines.push('## 候选', '', ...table(candidates.map((item) => ({ rank: item.rank, code: item.code, name: item.name, score: item.score, price: item.historical_price, action: item.action })), ['rank', 'code', 'name', 'score', 'price', 'action']), '');
    const blockers = value.blockers;
    if (blockers?.length)
        lines.push('## 风险闸门', '', ...blockers.map((item) => `- ${item}`), '');
    lines.push('## 完整机器事实', '', '```json', JSON.stringify(value, null, 2), '```', '');
    return lines.join('\n');
}
export function saveReport(kind, name, title, value) {
    const base = join(tradeMasterHome(), kind, safeName(name));
    writeJson(`${base}.json`, value);
    writeMarkdown(`${base}.md`, renderMarkdown(title, value));
    return { json: `${base}.json`, markdown: `${base}.md` };
}
