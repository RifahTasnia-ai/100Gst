export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    try {
        const isDev = !process.env.VERCEL

        // Add timestamp to bypass GitHub's aggressive caching (5-minute cache)
        const cacheBuster = `?t=${Date.now()}`

        // Get the config URL - from GitHub on Vercel, local in dev
        const repoPath = process.env.GITHUB_REPO ? (process.env.GITHUB_OWNER ? `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}` : process.env.GITHUB_REPO) : 'maruf7705/100GST'
        const configUrl = isDev
            ? `/exam-config.json${cacheBuster}`
            : `https://raw.githubusercontent.com/${repoPath}/main/exam-config.json${cacheBuster}`

        let config;

        try {
            const response = await fetch(configUrl, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            })

            if (!response.ok) {
                // Config doesn't exist, return default
                return res.status(200).json({
                    activeFile: 'questions.json',
                    setAt: null,
                    isDefault: true
                })
            }

            config = await response.json()
        } catch (fetchError) {
            // Config doesn't exist or network error, return default
            console.warn('Config fetch error:', fetchError)
            return res.status(200).json({
                activeFile: 'questions.json',
                setAt: null,
                isDefault: true
            })
        }

        // Verify the file still exists
        const activeFileUrl = isDev
            ? `/${config.activeQuestionFile}${cacheBuster}`
            : `https://${req.headers.host}/${config.activeQuestionFile}${cacheBuster}`

        try {
            const fileResponse = await fetch(activeFileUrl, {
                method: 'HEAD',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                }
            })

            if (!fileResponse.ok) {
                // File was deleted, return default
                return res.status(200).json({
                    activeFile: 'questions.json',
                    setAt: null,
                    isDefault: true,
                    warning: 'Previously selected file not found, using default'
                })
            }
        } catch (error) {
            // Can't verify file, but return config anyway
            console.warn('Could not verify active file:', error)
        }

        return res.status(200).json({
            activeFile: config.activeQuestionFile,
            setAt: config.lastUpdated,
            isDefault: false
        })

    } catch (error) {
        console.error('Error getting active question file:', error)

        // Return default on error
        return res.status(200).json({
            activeFile: 'questions.json',
            setAt: null,
            isDefault: true,
            error: 'Failed to read config, using default'
        })
    }
}
