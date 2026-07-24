import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  ReviewAggregate,
  ReviewCandidateReview,
  ReviewDateRange,
  ReviewPeriod,
  ReviewReport,
  ReviewSignalReview,
  ReviewStage
} from '../shared/review-types'

export type ReviewRatingInput = {
  targetType: 'candidate' | 'signal';
  targetId: string;
  rating: number;
  note?: string;
};

const reviewRoot = () => join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'reviews')
const reportPath = (period: ReviewPeriod, tradingDate: string) => join(reviewRoot(), period, `${tradingDate}.json`)

const writeJsonAtomic = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
};

export const loadReviewReport = async (period: ReviewPeriod, tradingDate: string): Promise<ReviewReport | null> => {
  try {
    const parsed = JSON.parse(await readFile(reportPath(period, tradingDate), 'utf8')) as ReviewReport;
    if (!parsed || parsed.schemaVersion !== 1) return null;
    if (parsed.stage === 'error') return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

export const saveReviewReport = async (report: ReviewReport): Promise<ReviewReport> => {
  await writeJsonAtomic(reportPath(report.period, report.range.tradingDate), report);
  return report;
};

const applyRatingToCandidates = (candidates: ReviewCandidateReview[] | undefined, input: ReviewRatingInput): ReviewCandidateReview[] | undefined => {
  if (!candidates) return candidates;
  return candidates.map((item) => item.id === input.targetId
    ? { ...item, userRating: Math.max(0, Math.min(5, input.rating)), userNote: input.note ?? item.userNote }
    : item);
};

const applyRatingToSignals = (signals: ReviewSignalReview[] | undefined, input: ReviewRatingInput): ReviewSignalReview[] | undefined => {
  if (!signals) return signals;
  return signals.map((item) => item.id === input.targetId
    ? { ...item, userRating: Math.max(0, Math.min(5, input.rating)), userNote: input.note ?? item.userNote }
    : item);
};

export const saveReviewRating = async (
  period: ReviewPeriod,
  tradingDate: string,
  input: ReviewRatingInput
): Promise<ReviewReport> => {
  const existing = await loadReviewReport(period, tradingDate);
  if (!existing) throw new Error('该周期复盘报告尚未生成，无法保存评价');
  const nextCandidates = input.targetType === 'candidate' ? applyRatingToCandidates(existing.candidateReviews, input) : existing.candidateReviews;
  const nextSignals = input.targetType === 'signal' ? applyRatingToSignals(existing.signalReviews, input) : existing.signalReviews;
  const updated: ReviewReport = {
    ...existing,
    candidateReviews: nextCandidates,
    signalReviews: nextSignals,
    aggregate: buildAggregate(nextCandidates || [], nextSignals || []),
    rawData: existing.rawData
      ? {
          ...existing.rawData,
          candidates: input.targetType === 'candidate' ? applyRatingToCandidates(existing.rawData.candidates, input) : existing.rawData.candidates,
          signals: input.targetType === 'signal' ? applyRatingToSignals(existing.rawData.signals, input) : existing.rawData.signals
        }
      : existing.rawData
  };
  return saveReviewReport(updated);
};

export const buildAggregate = (
  candidates: ReviewCandidateReview[],
  signals: ReviewSignalReview[]
): ReviewAggregate => {
  const verified = candidates.filter((item) => item.status === 'verified').length;
  const failed = candidates.filter((item) => item.status === 'failed').length;
  const watching = candidates.filter((item) => item.status === 'watching' || item.status === 'pending').length;
  const ratedCandidates = candidates.filter((item) => typeof item.userRating === 'number' && item.userRating > 0);
  const candidateAvgRating = ratedCandidates.length
    ? Math.round(ratedCandidates.reduce((sum, item) => sum + (item.userRating as number), 0) / ratedCandidates.length * 10) / 10
    : null;
  const evaluated = signals.filter((item) => item.outcomeStatus !== 'pending' && item.outcomeStatus !== 'watching');
  const directional = signals.filter((item) => item.directionalReturnPercent != null).map((item) => item.directionalReturnPercent as number);
  const correct = evaluated.filter((item) => (item.directionalReturnPercent ?? 0) > 0).length;
  const blindSpots: string[] = [];
  const failedSignals = signals.filter((item) => item.outcomeStatus === 'failed');
  if (failedSignals.length) blindSpots.push(failedSignals.length + ' 个信号方向判断失误，需复核趋势阶段与触发条件');
  const failedCandidates = candidates.filter((item) => item.status === 'failed');
  if (failedCandidates.length) blindSpots.push(failedCandidates.length + ' 个数据候选未达预期，需复核次日剧本与失效条件');
  if (!evaluated.length) blindSpots.push('信号样本不足，暂不能形成稳定的准确率结论');
  const suggestions: string[] = [];
  if (verified) suggestions.push('保留 ' + verified + ' 个已验证候选的共同证据，作为新策略候选的输入');
  if (failed) suggestions.push('对 ' + failed + ' 个失效候选做归因，重点检查是否误判了退潮期或分歧转退潮');
  if (!suggestions.length) suggestions.push('本轮复盘没有形成明确的沉淀建议，继续积累样本');
  const ratedSignals = signals.filter((item) => typeof item.userRating === 'number' && item.userRating > 0);
  const signalAvgRating = ratedSignals.length
    ? Math.round(ratedSignals.reduce((sum, item) => sum + (item.userRating as number), 0) / ratedSignals.length * 10) / 10
    : null;
  return {
    candidateTotal: candidates.length,
    candidateVerified: verified,
    candidateFailed: failed,
    candidateWatching: watching,
    candidateRatedCount: ratedCandidates.length,
    candidateAvgRating,
    signalTotal: signals.length,
    signalEvaluated: evaluated.length,
    signalAccuracyPercent: evaluated.length ? Math.round((correct / evaluated.length) * 1000) / 10 : null,
    averageDirectionalReturnPercent: directional.length ? Math.round(directional.reduce((sum, value) => sum + value, 0) / directional.length * 100) / 100 : null,
    signalRatedCount: ratedSignals.length,
    signalAvgRating,
    blindSpots,
    suggestions
  };
};

export const emptyReport = (
  period: ReviewPeriod,
  range: ReviewDateRange,
  stage: ReviewStage,
  error?: string
): ReviewReport => ({
  schemaVersion: 1,
  id: `review-${period}-${range.tradingDate}`,
  period,
  range,
  stage,
  generatedAt: new Date().toISOString(),
  dataAsOf: new Date().toISOString(),
  error
});
