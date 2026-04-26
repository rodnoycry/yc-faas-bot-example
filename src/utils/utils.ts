export const unknownToString = (obj: unknown): string => {
    if (typeof obj === "string") {
        return obj
    } else if (typeof obj === "object") {
        try {
            return JSON.stringify(obj, null, 2)
        } catch {
            return String(obj)
        }
    } else {
        return String(obj)
    }
}

export function compileUrlWithParams({
    baseUrl,
    params,
}: {
    baseUrl: string
    params: Record<string, string>
}): string {
    const url = new URL(baseUrl)
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value)
    })
    return url.toString()
}
