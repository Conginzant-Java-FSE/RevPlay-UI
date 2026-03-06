const KNOWN_ROLES = ['LISTENER', 'ARTIST', 'ADMIN'];
const ROLE_LEVEL: Record<string, number> = {
    LISTENER: 1,
    ARTIST: 2,
    ADMIN: 3
};

const ROLE_ALIASES: Record<string, string> = {
    BOTH: 'ARTIST',
    MUSIC: 'ARTIST',
    PODCAST: 'ARTIST',
    CREATOR: 'ARTIST'
};

function normalizeRoleToken(value: unknown): string {
    return String(value ?? '').trim().toUpperCase();
}

function sanitizeRoleCandidate(value: unknown): string {
    const normalized = normalizeRoleToken(value);
    if (!normalized) {
        return '';
    }
    const stripped = normalized.startsWith('ROLE_') ? normalized.slice(5) : normalized;
    return ROLE_ALIASES[stripped] ?? stripped;
}

function extractFromIterable(values: unknown[]): string {
    for (const value of values) {
        const role = sanitizeRoleCandidate(value);
        if (KNOWN_ROLES.includes(role)) {
            return role;
        }
    }
    return '';
}

export function resolvePrimaryRole(userOrRole: any): string {
    if (!userOrRole) {
        return '';
    }

    if (typeof userOrRole === 'string') {
        return sanitizeRoleCandidate(userOrRole);
    }

    const directRole = sanitizeRoleCandidate(userOrRole.role);
    if (KNOWN_ROLES.includes(directRole)) {
        return directRole;
    }

    if (Array.isArray(userOrRole.roles)) {
        const role = extractFromIterable(userOrRole.roles);
        if (role) {
            return role;
        }
    }

    if (Array.isArray(userOrRole.authorities)) {
        const authorities = userOrRole.authorities.map((item: any) =>
            typeof item === 'string' ? item : item?.authority
        );
        const role = extractFromIterable(authorities);
        if (role) {
            return role;
        }
    }

    return directRole;
}

export function hasRole(userOrRole: any, expectedRole: string): boolean {
    return resolvePrimaryRole(userOrRole) === sanitizeRoleCandidate(expectedRole);
}

export function hasAnyRole(userOrRole: any, expectedRoles: string[]): boolean {
    const currentRole = resolvePrimaryRole(userOrRole);
    if (!currentRole) {
        return false;
    }
    const currentLevel = ROLE_LEVEL[currentRole] ?? 0;
    return expectedRoles.some((role) => {
        const expected = sanitizeRoleCandidate(role);
        // Artist-only surfaces should stay artist-only (admin should not inherit artist studio).
        if (expected === 'ARTIST') {
            return currentRole === 'ARTIST';
        }
        const expectedLevel = ROLE_LEVEL[expected] ?? 0;
        if (!expectedLevel) {
            return false;
        }
        return currentLevel >= expectedLevel;
    });
}
