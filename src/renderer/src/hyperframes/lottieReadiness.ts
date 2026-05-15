export function isLottieAnimationLoaded(animation: unknown): boolean {
  if (!animation || typeof animation !== 'object') {
    return true
  }

  const candidate = animation as {
    isLoaded?: unknown
    isPaused?: unknown
    totalFrames?: unknown
    currentFrame?: unknown
  }

  if (typeof candidate.isLoaded === 'boolean') {
    return candidate.isLoaded
  }

  if (typeof candidate.totalFrames === 'number') {
    return candidate.totalFrames > 0
  }

  return true
}
