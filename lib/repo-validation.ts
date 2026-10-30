/**
 * Shared validation helper for GitHub repository owner and name.
 *
 * Rules:
 * - owner must match /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
 * - repo must match /^[A-Za-z0-9_.-]{1,100}$/ and must not be "." or ".." or end with ".git"
 */

export interface ValidationResult {
    valid: boolean;
    owner?: string;
    repo?: string;
    error?: string;
}

export function validateRepoOwnerAndName(owner: unknown, repo: unknown): ValidationResult {
    if (typeof owner !== 'string' || typeof repo !== 'string') {
        return { valid: false, error: 'Owner and repo must be strings' };
    }

    const trimmedOwner = owner.trim();
    const trimmedRepo = repo.trim();

    const ownerRegex = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
    if (!ownerRegex.test(trimmedOwner)) {
        return { valid: false, error: 'Invalid repository owner' };
    }

    const repoRegex = /^[A-Za-z0-9_.-]{1,100}$/;
    if (
        !repoRegex.test(trimmedRepo) ||
        trimmedRepo === '.' ||
        trimmedRepo === '..' ||
        trimmedRepo.endsWith('.git')
    ) {
        return { valid: false, error: 'Invalid repository name' };
    }

    return {
        valid: true,
        owner: trimmedOwner,
        repo: trimmedRepo,
    };
}

export function parseAndValidateRepoInput(input: unknown): ValidationResult {
    if (typeof input !== 'string') {
        return { valid: false, error: 'Repository input must be a string' };
    }

    const trimmed = input.trim();
    const parts = trimmed.split('/');
    if (parts.length !== 2) {
        return { valid: false, error: 'Repository must be in "owner/repo" format' };
    }

    return validateRepoOwnerAndName(parts[0], parts[1]);
}
