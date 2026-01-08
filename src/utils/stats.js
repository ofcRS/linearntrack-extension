// utils/stats.js
import { getAllNumbers, getDistribution } from './storage.js';
/**
 * Chi-Square Test using jStat
 */
function calculateChiSquare(observed, expected) {
    if (observed.length !== expected.length) {
        throw new Error("Observed and expected arrays must be of the same length.");
    }

    // Calculate Chi-Square Statistic
    let chiSquareStatistic = 0;
    for (let i = 0; i < observed.length; i++) {
        if (expected[i] === 0) {
            throw new Error("Expected frequency cannot be zero.");
        }
        chiSquareStatistic += Math.pow(observed[i] - expected[i], 2) / expected[i];
    }

    // Degrees of Freedom
    let degreesOfFreedom = observed.length - 1;

    // Calculate p-value using jStat
    // p-value is the probability of observing a chi-square value as extreme as the calculated one
    let pValue = 1 - jStat.chisquare.cdf(chiSquareStatistic, degreesOfFreedom);

    return {
        chiSquareStatistic,
        degreesOfFreedom,
        pValue
    };
}

export const getChiSquare = async (segments) => {
    const distribution = await getDistribution(); // { 0: 10, 1: 20, 2: 30, ... }
    const expected = Array.from({ length: segments }).map(() => segments); // [10, 10, 10, ...]
    return calculateChiSquare(Object.values(distribution), expected);
}