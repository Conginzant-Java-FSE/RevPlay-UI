function normalize(value: any): string {
    return String(value ?? '').trim().toLowerCase();
}

function extractBackendMessage(error: any): string {
    return String(
        error?.error?.message ??
        error?.error?.error ??
        error?.message ??
        ''
    ).trim();
}

function fromBackendKeywords(status: number, message: string): string | null {
    const normalized = normalize(message);

    if (!normalized) {
        return null;
    }

    if (normalized.includes('bad credentials') || normalized.includes('invalid credentials')) {
        return 'Incorrect login details. Please check username/email and password.';
    }

    if (normalized.includes('email') && normalized.includes('not found')) {
        return 'This email is not registered.';
    }

    if (normalized.includes('username') && normalized.includes('not found')) {
        return 'This username does not exist.';
    }

    if (normalized.includes('password') && (normalized.includes('wrong') || normalized.includes('invalid') || normalized.includes('incorrect'))) {
        return 'Password is incorrect.';
    }

    if (normalized.includes('username') && (normalized.includes('exist') || normalized.includes('taken') || normalized.includes('already'))) {
        return 'This username is already in use. Try another one.';
    }

    if (normalized.includes('email') && (normalized.includes('exist') || normalized.includes('taken') || normalized.includes('already'))) {
        return 'This email is already linked to an account.';
    }

    if (normalized.includes('password') && (normalized.includes('weak') || normalized.includes('length') || normalized.includes('at least'))) {
        return 'Use a stronger password with at least 8 characters.';
    }

    if (normalized.includes('password') && (normalized.includes('match') || normalized.includes('mismatch'))) {
        return 'Passwords do not match.';
    }

    if (normalized.includes('already used') || normalized.includes('reuse')) {
        return 'This value is already used. Please choose a different one.';
    }

    if (normalized.includes('access denied') || normalized.includes('forbidden') || normalized.includes('not allowed')) {
        return 'You do not have permission to do this action.';
    }

    if (normalized.includes('not found')) {
        return 'Requested data was not found.';
    }

    if (status === 409) {
        return 'This data already exists. Please change input and try again.';
    }

    return message;
}

function fromStatus(status: number, url: string): string {
    const lowerUrl = normalize(url);

    if (status === 0) {
        return 'Unable to connect to server. Please check your network or backend.';
    }

    if (status === 400) {
        return 'Please check the entered details and try again.';
    }

    if (status === 401) {
        if (lowerUrl.includes('/auth/login')) {
            return 'Incorrect username/email or password.';
        }
        return 'Your session expired. Please log in again.';
    }

    if (status === 403) {
        return 'You do not have permission to access this feature.';
    }

    if (status === 404) {
        return 'Requested resource was not found.';
    }

    if (status === 409) {
        if (lowerUrl.includes('/auth/register')) {
            return 'This email or username is already registered.';
        }
        return 'This record already exists.';
    }

    if (status === 422) {
        return 'Some details are invalid. Please review and submit again.';
    }

    if (status === 429) {
        return 'Too many requests. Please wait a moment and retry.';
    }

    if (status >= 500) {
        return 'Server is having trouble right now. Please try again shortly.';
    }

    return 'Something went wrong. Please try again.';
}

export function resolveHttpErrorMessage(error: any, requestUrl = ''): string {
    const status = Number(error?.status ?? 0);
    const backendMessage = extractBackendMessage(error);
    const keywordMessage = fromBackendKeywords(status, backendMessage);
    if (keywordMessage) {
        return keywordMessage;
    }
    return fromStatus(status, requestUrl);
}
