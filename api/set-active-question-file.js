export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    try {
        const { fileName } = req.body

        // Validate input
        if (!fileName || typeof fileName !== 'string') {
            return res.status(400).json({ error: 'Invalid file name' })
        }

        // Validate file name is a JSON file
        if (!fileName.endsWith('.json')) {
            return res.status(400).json({ error: 'File must be a JSON file' })
        }

        const isDev = !process.env.VERCEL

        // Check if file exists
        const fileUrl = isDev
            ? `/${fileName}`
            : `https://${req.headers.host}/${fileName}`

        try {
            const fileResponse = await fetch(fileUrl, { method: 'HEAD', cache: 'no-store' })

            if (!fileResponse.ok) {
                return res.status(404).json({ error: 'Question file not found' })
            }
        } catch (error) {
            return res.status(404).json({ error: 'Question file not found', details: error.message })
        }

        // Validate that it's a valid JSON file
        try {
            const fileContent = await fetch(fileUrl, { cache: 'no-store' })
            const questions = await fileContent.json()

            // Basic validation - should be an array
            if (!Array.isArray(questions)) {
                return res.status(400).json({ error: 'Invalid question file format - must be an array' })
            }

            if (questions.length === 0) {
                return res.status(400).json({ error: 'Question file is empty' })
            }
        } catch (parseError) {
            return res.status(400).json({ error: 'Invalid JSON file' })
        }

        // Create config object
        const config = {
            activeQuestionFile: fileName,
            lastUpdated: new Date().toISOString()
        }

        // On Vercel, we need to update the file in GitHub
        // For now, we'll use environment variable for GitHub token
        if (!isDev) {
            const GITHUB_TOKEN = process.env.GITHUB_TOKEN
            const GITHUB_REPO = process.env.GITHUB_REPO ? (process.env.GITHUB_OWNER ? `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}` : process.env.GITHUB_REPO) : 'maruf7705/100GST'

            if (!GITHUB_TOKEN) {
                return res.status(500).json({
                    error: 'GitHub token not configured',
                    note: 'Please set GITHUB_TOKEN in Vercel environment variables'
                })
            }

            try {
                // Get current file SHA (needed for updating)
                const getFileUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/exam-config.json`
                const getResponse = await fetch(getFileUrl, {
                    headers: {
                        'Authorization': `Bearer ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                })

                let sha = null
                if (getResponse.ok) {
                    const fileData = await getResponse.json()
                    sha = fileData.sha
                }

                // Update the file
                const content = Buffer.from(JSON.stringify(config, null, 2)).toString('base64')

                const updateResponse = await fetch(getFileUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: `Update active question file to ${fileName}`,
                        content: content,
                        sha: sha,
                        branch: 'main'
                    })
                })

                if (!updateResponse.ok) {
                    const errorData = await updateResponse.json()
                    throw new Error(`GitHub API error: ${errorData.message}`)
                }
            } catch (githubError) {
                console.error('GitHub update failed:', githubError)
                return res.status(500).json({
                    error: 'Failed to update config in GitHub',
                    details: githubError.message
                })
            }
        } else {
            // Local development - write to filesystem
            const fs = require('fs')
            const path = require('path')
            const configPath = path.join(process.cwd(), 'exam-config.json')
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
        }

        return res.status(200).json({
            success: true,
            activeFile: fileName,
            message: 'Active question file updated successfully'
        })

    } catch (error) {
        console.error('Error setting active question file:', error)
        return res.status(500).json({
            error: 'Failed to set active question file',
            details: error.message
        })
    }
}
