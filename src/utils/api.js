export async function saveSubmission(payload) {
  let res;
  try {
    res = await fetch('/api/save-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } catch (fetchErr) {
    throw fetchErr;
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || 'Failed to save submission')
  }

  const result = await res.json()
  return result
}

export async function deleteSubmission(studentName, timestamp) {
  let res;
  try {
    res = await fetch('/api/delete-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentName, timestamp })
    })
  } catch (fetchErr) {
    throw fetchErr;
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || 'Failed to delete submission')
  }

  return res.json()
}

export async function deleteStudent(studentName) {
  let res;
  try {
    res = await fetch('/api/delete-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentName })
    })
  } catch (fetchErr) {
    throw fetchErr;
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || 'Failed to delete student')
  }

  return res.json()
}

export async function loadSubmissions() {
  const isDev = window.location.hostname === 'localhost'
  const url = isDev
    ? '/answers.json'
    : 'https://raw.githubusercontent.com/maruf7705/100GST/main/answers.json'

  let res;
  try {
    res = await fetch(url, {
      cache: 'no-store'
    })
  } catch (fetchErr) {
    throw fetchErr;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Could not read error')
    throw new Error(`Failed to load submissions: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  return data
}

export async function loadLatestQuestions() {
  // Try to find the latest question file by checking in descending order
  // Try questions-100.json down to questions-1.json, then questions.json

  for (let version = 100; version >= 1; version--) {
    const fileName = `questions-${version}.json`
    try {
      const res = await fetch(`/${fileName}`)
      if (res.ok) {
        // Try to parse as JSON to verify it's a valid file
        const text = await res.text()
        JSON.parse(text) // This will throw if it's not valid JSON (like HTML)
        console.log(`Found latest questions file: ${fileName}`)
        return { file: fileName, version }
      }
    } catch (error) {
      // File doesn't exist or is not valid JSON, continue to next
      continue
    }
  }

  // Fallback to questions.json
  console.log('Using default questions.json')
  return { file: 'questions.json', version: 0 }
}

export async function savePendingStudent(studentName, timestamp = null) {
  let res;
  try {
    res = await fetch('/api/save-pending-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentName,
        timestamp: timestamp ? new Date(timestamp).toISOString() : undefined
      })
    })
  } catch (fetchErr) {
    throw fetchErr;
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || 'Failed to save pending student')
  }

  return res.json()
}

export async function removePendingStudent(studentName) {
  let res;
  try {
    res = await fetch('/api/remove-pending-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentName })
    })
  } catch (fetchErr) {
    throw fetchErr;
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || 'Failed to remove pending student')
  }

  return res.json()
}

export async function loadPendingStudents() {
  const isDev = window.location.hostname === 'localhost'
  const url = isDev
    ? '/pending-students.json'
    : 'https://raw.githubusercontent.com/maruf7705/100GST/main/pending-students.json'

  let res;
  try {
    res = await fetch(url, {
      cache: 'no-store'
    })
  } catch (fetchErr) {
    throw fetchErr;
  }

  if (!res.ok) {
    // If file doesn't exist yet, return empty array
    if (res.status === 404) {
      return []
    }
    const text = await res.text().catch(() => 'Could not read error')
    throw new Error(`Failed to load pending students: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  return data
}

// Question File Management APIs
export async function loadQuestionFiles() {
  let res;
  try {
    res = await fetch('/api/list-question-files', {
      cache: 'no-store'
    })
  } catch (fetchErr) {
    throw fetchErr;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Could not read error')
    throw new Error(`Failed to load question files: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  return data.files
}

export async function getActiveQuestionFile() {
  // If running on localhost without Vercel functions, fall back to default
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // Try to fetch active file from localStorage or exam-config.json if possible, 
    // otherwise default to questions.json
    console.warn('Running locally, skipping API call for active file')
    return { activeFile: 'GST-Admission-2024-25.json' }
    // Defaulting to the new file since that's what we want to test
  }

  let res;
  try {
    res = await fetch('/api/get-active-question-file', {
      cache: 'no-store'
    })
  } catch (fetchErr) {
    console.warn('API fetch failed, using default', fetchErr)
    return { activeFile: 'questions.json' }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'Could not read error')
    // If 404 or other error, fallback
    console.warn(`Failed to get active question file: ${res.status}, using default`)
    return { activeFile: 'questions.json' }
  }

  try {
    const data = await res.json()
    return data
  } catch (e) {
    // If response is not JSON (e.g. source code "export default"), fallback
    console.warn('API returned invalid JSON, using default', e)
    return { activeFile: 'questions.json' }
  }
}

export async function setActiveQuestionFile(fileName) {
  let res;
  try {
    res = await fetch('/api/set-active-question-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName })
    })
  } catch (fetchErr) {
    throw fetchErr;
  }

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || 'Failed to set active question file')
  }

  return res.json()
}


