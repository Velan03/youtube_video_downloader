document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Elements ---
  const videoUrlInput = document.getElementById("video-url")
  const fetchBtn = document.getElementById("fetch-btn")
  const downloadBtn = document.getElementById("download-btn")
  const videoInfo = document.getElementById("video-info")
  const loadingIndicator = document.getElementById("loading-indicator")
  const errorMessage = document.getElementById("error-message")
  const errorText = document.getElementById("error-text")
  const thumbnail = document.getElementById("thumbnail")
  const videoTitle = document.getElementById("video-title")
  const videoDuration = document.getElementById("video-duration").querySelector("span")
  const videoDurationBadge = document.querySelector("#video-duration-badge span")
  const videoUploader = document.getElementById("video-uploader").querySelector("span")
  const qualityOptions = document.getElementById("quality-options")
  const statusMessage = document.getElementById("status-message")
  const downloadBtnText = downloadBtn.querySelector(".btn-text")
  const downloadProgressBar = downloadBtn.querySelector(".progress-bar")
  const selectedSizeDisplay = document.getElementById("selected-size-display")
  const closeAlertBtn = document.querySelector(".close-alert")

  // --- State Variables ---
  let selectedFormatId = null // Stores the format ID selected by the user
  let currentDownloadId = null // Stores the unique ID for the current download task
  let progressInterval = null // Stores the interval timer for polling progress

  // --- Event Listeners ---
  // Trigger fetching video info when the fetch button is clicked
  fetchBtn.addEventListener("click", fetchVideoInfo)

  // Trigger fetching video info when Enter is pressed in the URL input
  videoUrlInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault() // Prevent default form submission behavior
      fetchVideoInfo()
    }
  })

  // Trigger starting the download when the download button is clicked
  downloadBtn.addEventListener("click", startDownload)

  // Close error message when the close button is clicked
  if (closeAlertBtn) {
    closeAlertBtn.addEventListener("click", () => {
      errorMessage.classList.add("hidden")
    })
  }

  // Add animation to the input field when it receives focus
  videoUrlInput.addEventListener("focus", () => {
    videoUrlInput.style.transform = "scale(1.01)"
  })

  videoUrlInput.addEventListener("blur", () => {
    videoUrlInput.style.transform = "scale(1)"
  })

  // --- Functions ---
  /**
   * Fetches video information from the backend based on the URL input.
   */
  async function fetchVideoInfo() {
    const url = videoUrlInput.value.trim()

    // Input validation
    if (!url) {
      showError("Please enter a YouTube URL.")
      return
    }

    if (!isValidYouTubeUrl(url)) {
      showError("Please enter a valid YouTube URL.")
      return
    }

    // Reset UI elements and show loading indicator
    resetUI()
    showLoading()

    try {
      // Send POST request to backend to fetch video info
      const response = await fetch("/fetch-info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url }),
      })

      const data = await response.json()

      // Check if the response was successful (status code 2xx)
      if (!response.ok) {
        // Throw an error with the message from the backend if available
        throw new Error(data.error || "Failed to fetch video information.")
      }

      // Display the retrieved video information and formats
      displayVideoInfo(data)
    } catch (error) {
      // Display any errors that occurred during fetch or backend processing
      showError(error.message || "An unknown error occurred while fetching video information.")
    } finally {
      // Always hide the loading indicator when the fetch is complete
      hideLoading()
    }
  }

  /**
   * Displays the video information and quality options received from the backend.
   * @param {object} data - The video info data structure from the backend.
   */
  function displayVideoInfo(data) {
    // Set video details in the UI
    videoTitle.textContent = data.title
    // Use backend thumbnail URL, fallback to a local placeholder if not available
    thumbnail.src = data.thumbnail || "/static/images/placeholder.jpg"

    // Format and display duration in both places
    const formattedDuration = formatDuration(data.duration)
    videoDuration.textContent = formattedDuration
    videoDurationBadge.textContent = formattedDuration

    videoUploader.textContent = data.uploader

    // Clear previous quality options and selected size display
    qualityOptions.innerHTML = ""
    selectedFormatId = null // Reset the selected format ID
    // Clear the selected size display when new info is loaded
    if (selectedSizeDisplay) {
      // Check if element exists
      selectedSizeDisplay.textContent = ""
    }

    // Check if formats are available and display them
    if (data.formats && data.formats.length > 0) {
      data.formats.forEach((format) => {
        const option = document.createElement("div")
        option.className = "quality-option"

        // Store necessary format info using data attributes
        option.dataset.formatId = format.format_id
        option.dataset.height = format.height
        option.dataset.ext = format.ext
        // Store the formatted filesize string for easy display
        option.dataset.filesizeDisplay = format.filesize ? formatFileSize(format.filesize) : "Unknown size" // Handle cases with no filesize

        const qualityLabel = document.createElement("span")
        qualityLabel.className = "quality"
        qualityLabel.textContent = format.quality_label

        const sizeLabel = document.createElement("span")
        sizeLabel.className = "size"
        // Display filesize if available, otherwise show 'Unknown size'
        sizeLabel.textContent = option.dataset.filesizeDisplay

        option.appendChild(qualityLabel)
        option.appendChild(sizeLabel)

        // Add click listener to select this quality option
        option.addEventListener("click", () => {
          // Remove 'selected' class from all options
          document.querySelectorAll(".quality-option").forEach((el) => {
            el.classList.remove("selected")
          })
          // Add 'selected' class to the clicked option
          option.classList.add("selected")
          // Store the selected format ID in the state
          selectedFormatId = format.format_id
          // Enable the download button once a quality is selected
          downloadBtn.disabled = false
          // Reset download button visual state (text, progress bar)
          resetDownloadButtonVisual()
          statusMessage.textContent = "Quality selected. Ready to download."

          // --- Update the selected size display ---
          if (selectedSizeDisplay) {
            // Check if element exists
            selectedSizeDisplay.textContent = `Selected Size: ${option.dataset.filesizeDisplay}`
          }
        })

        // Add the created quality option to the grid
        qualityOptions.appendChild(option)
      })

      // Automatically select the first quality option (usually the highest resolution)
      if (qualityOptions.firstChild) {
        // Check if there are any quality options
        qualityOptions.firstChild.click() // Programmatically trigger click to select it
      }
    } else {
      // Handle case where no formats are available or suitable
      qualityOptions.innerHTML = "<p>No downloadable formats found for this video.</p>"
      downloadBtn.disabled = true // Ensure download button is disabled
      statusMessage.textContent = "No formats available." // Inform the user
      if (selectedSizeDisplay) {
        // Check if element exists
        selectedSizeDisplay.textContent = "" // Clear selected size display
      }
    }

    // Show the video info section that contains the preview and quality options
    videoInfo.classList.remove("hidden")

    // Add a subtle entrance animation
    videoInfo.style.opacity = "0"
    videoInfo.style.transform = "translateY(20px)"

    setTimeout(() => {
      videoInfo.style.opacity = "1"
      videoInfo.style.transform = "translateY(0)"
      videoInfo.style.transition = "opacity 0.5s ease, transform 0.5s ease"
    }, 50)
  }

  /**
   * Starts the video download process by requesting a download ID from the backend.
   */
  async function startDownload() {
    // Prevent download if no format is selected
    if (!selectedFormatId) {
      showError("Please select a quality option before downloading.")
      return
    }

    const url = videoUrlInput.value.trim()
    const title = videoTitle.textContent // Get the video title for filename

    // --- Update UI to indicate download is starting ---
    downloadBtn.disabled = true // Disable the button to prevent multiple clicks
    statusMessage.textContent = "Initiating download..." // Update status message
    // Reset and show starting state for the progress button
    downloadProgressBar.style.width = "0%"
    downloadBtnText.innerHTML = '<i class="fas fa-download"></i> Starting...'

    try {
      // Send POST request to the backend to start the download task
      const response = await fetch("/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: url,
          format_id: selectedFormatId,
          filename: title, // Pass the video title as a base filename suggestion
        }),
      })

      const data = await response.json()

      // Check if the response was successful (backend should return 200 OK)
      if (!response.ok) {
        // Throw an error with the message from the backend
        throw new Error(data.error || "Download initiation failed.")
      }

      // Store the unique download ID received from the backend
      currentDownloadId = data.download_id
      statusMessage.textContent = "Download in progress..." // Update status message

      // Start polling the backend periodically to get download progress updates
      monitorDownloadProgress(currentDownloadId)
    } catch (error) {
      // Handle errors that occur during the initiation of the download task
      statusMessage.textContent = "Error: " + error.message // Display error message to user
      // Re-enable the download button only if no download ID was obtained
      if (!currentDownloadId) {
        downloadBtn.disabled = false
        resetDownloadButtonVisual() // Reset button visual state
      }
    }
  }

  /**
   * Polls the backend periodically for the current download progress using the download ID.
   * Updates the UI (progress bar and status message) based on the response.
   * @param {string} downloadId - The unique ID for the download task to monitor.
   */
  function monitorDownloadProgress(downloadId) {
    // Clear any existing polling interval to avoid multiple intervals running simultaneously
    if (progressInterval) {
      clearInterval(progressInterval)
    }

    // Set up a new interval to call the progress endpoint every second (1000ms)
    progressInterval = setInterval(async () => {
      try {
        const response = await fetch(`/progress/${downloadId}`)
        const data = await response.json()

        // Handle cases where the download ID is no longer found on the backend
        if (response.status === 404) {
          clearInterval(progressInterval) // Stop polling
          progressInterval = null
          statusMessage.textContent = data.error || "Download task not found or expired."
          showError(data.error || "Download task not found or expired. Please try fetching again.")
          resetDownloadButtonFull() // Reset button and clear ID
          return // Stop processing this interval tick
        }

        // Handle other backend errors during progress check
        if (!response.ok) {
          clearInterval(progressInterval) // Stop polling
          progressInterval = null
          statusMessage.textContent = data.error || "Failed to check progress."
          showError(data.error || "An error occurred while checking download progress.")
          resetDownloadButtonFull() // Reset button and clear ID
          return // Stop processing this interval tick
        }

        const progress = data.progress // Get the progress percentage (0-100 or -1 for error)

        // --- Update the progress bar width ---
        // Ensure the width is within valid range [0%, 100%]
        downloadProgressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`

        // --- Update button text based on progress ---
        if (progress > 0 && progress < 100) {
          // Display percentage during download
          downloadBtnText.innerHTML = `<i class="fas fa-download"></i> ${Math.round(progress)}%`
          statusMessage.textContent = "Downloading..."
        } else if (progress === 0) {
          // Indicate starting state (might be brief)
          downloadBtnText.innerHTML = '<i class="fas fa-download"></i> Starting...'
          statusMessage.textContent = "Starting download..."
        }

        // --- Handle download failure ---
        if (progress === -1) {
          clearInterval(progressInterval) // Stop polling
          progressInterval = null
          statusMessage.textContent = data.error || "Download failed." // Show failure message
          // Change button text to suggest trying again
          downloadBtnText.innerHTML = '<i class="fas fa-download"></i> Try Again'
          downloadProgressBar.style.width = "0%" // Reset progress bar visual
          downloadBtn.disabled = false // Re-enable the button
          currentDownloadId = null // Clear the download ID on failure
          return // Stop processing
        }

        // --- Handle download completion ---
        if (progress >= 100) {
          clearInterval(progressInterval) // Stop polling
          progressInterval = null
          statusMessage.textContent = "Download complete! Preparing file..." // Update status message
          // Change button text to indicate completion
          downloadBtnText.innerHTML = '<i class="fas fa-check"></i> Complete'
          downloadProgressBar.style.width = "100%" // Ensure progress bar is full

          // Add a small delay before attempting to trigger the file download
          setTimeout(() => completeDownload(downloadId), 1500) // Wait 1.5 seconds
        }
      } catch (error) {
        // Handle network errors or unexpected issues during polling itself
        clearInterval(progressInterval) // Stop polling
        progressInterval = null
        statusMessage.textContent = "Error checking progress: " + error.message // Display error message
        showError("Error checking download progress: " + error.message)
        resetDownloadButtonFull() // Reset button and clear ID
      }
    }, 1000) // Poll every 1000 milliseconds (1 second)
  }

  /**
   * Triggers the file download in the browser by redirecting to the /get-file endpoint.
   * Resets the UI elements after a delay to prepare for a new download.
   * @param {string} downloadId - The unique ID for the download task whose file should be served.
   */
  async function completeDownload(downloadId) {
    try {
      // Redirecting the browser to this URL tells Flask to send the file
      window.location.href = `/get-file/${downloadId}`

      statusMessage.textContent = "Your download should begin shortly. Check your browser's downloads." // Inform the user

      // --- Reset UI elements after download initiation ---
      // Add a delay to keep the "Complete" status visible briefly
      setTimeout(() => {
        resetDownloadButtonVisual() // Reset progress bar and button text visual
        downloadBtn.disabled = false // Re-enable the download button
        // Clear the status message after the button is re-enabled
        statusMessage.textContent = "Ready for next download."
        // Optionally clear status message after a few more seconds
        setTimeout(() => {
          statusMessage.textContent = ""
        }, 5000) // Clear status after 5 seconds
        currentDownloadId = null // Clear the download ID after completion
      }, 2000) // Wait 2 seconds before resetting UI
    } catch (error) {
      // This catch block is unlikely to be hit by window.location.href directly,
      // but included for completeness.
      statusMessage.textContent = "Error initiating file download: " + error.message
      showError("Could not initiate file download after completion.")
      resetDownloadButtonFull() // Reset button and clear ID
    }
  }

  // --- Helper Functions ---

  /**
   * Displays an error message in the designated area and hides others.
   * @param {string} message - The error message to display.
   */
  function showError(message) {
    errorText.textContent = message
    errorMessage.classList.remove("hidden")
    // Ensure video info and loading are hidden when showing error
    videoInfo.classList.add("hidden")
    loadingIndicator.classList.add("hidden")

    // Add a subtle shake animation to the error message
    errorMessage.classList.add("shake")
    setTimeout(() => {
      errorMessage.classList.remove("shake")
    }, 500)

    // Auto hide the error message after a few seconds
    setTimeout(() => {
      errorMessage.classList.add("hidden")
    }, 7000) // Hide after 7 seconds
  }

  /**
   * Shows the loading indicator and disables the fetch button.
   */
  function showLoading() {
    loadingIndicator.classList.remove("hidden")
    fetchBtn.disabled = true // Disable fetch button while loading
    // Ensure error and video info are hidden
    errorMessage.classList.add("hidden")
    videoInfo.classList.add("hidden")
  }

  /**
   * Hides the loading indicator and re-enables the fetch button.
   */
  function hideLoading() {
    loadingIndicator.classList.add("hidden")
    fetchBtn.disabled = false // Re-enable fetch button
  }

  /**
   * Resets the main UI elements to their initial state (hiding video info, errors, clearing inputs).
   */
  function resetUI() {
    errorMessage.classList.add("hidden")
    videoInfo.classList.add("hidden") // Hide video info section
    selectedFormatId = null // Clear selected format
    // Clear button state and disable
    resetDownloadButtonFull() // Reset button and clear ID

    // Clear dynamic content
    qualityOptions.innerHTML = "" // Clear quality options grid
    statusMessage.textContent = "" // Clear status message
    if (selectedSizeDisplay) {
      // Check if element exists
      selectedSizeDisplay.textContent = "" // Clear selected size display
    }

    // Clear any active progress polling
    if (progressInterval) {
      clearInterval(progressInterval)
      progressInterval = null
    }
  }

  /**
   * Resets only the visual state (text, progress bar) of the download button.
   */
  function resetDownloadButtonVisual() {
    downloadProgressBar.style.width = "0%" // Reset progress bar width
    downloadBtnText.innerHTML = '<i class="fas fa-download"></i> Download' // Reset button text
  }

  /**
   * Resets the full state of the download button, including clearing current download ID.
   */
  function resetDownloadButtonFull() {
    resetDownloadButtonVisual() // Reset visual state
    downloadBtn.disabled = true // Ensure button is disabled
    currentDownloadId = null // Clear the download ID
  }

  /**
   * Validates if the given URL is likely a YouTube URL using a regular expression.
   * @param {string} url - The URL string to validate.
   * @returns {boolean} True if the URL matches a common YouTube pattern, false otherwise.
   */
  function isValidYouTubeUrl(url) {
    // Regex matching various YouTube URL formats (watch, embed, v, shorts)
    const pattern =
      /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/(watch\?v=|embed\/|v\/|shorts\/|)([a-zA-Z0-9_-]{11})(.*)?$/
    return pattern.test(url)
  }

  /**
   * Formats video duration from seconds into a human-readable string (MM:SS or HH:MM:SS).
   * @param {number} seconds - The duration in seconds.
   * @returns {string} Formatted duration string (e.g., "5:30" or "1:15:05").
   */
  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || seconds < 0) return "Unknown"

    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    // Pad minutes and seconds with leading zero if less than 10
    const paddedMinutes = minutes < 10 && hours > 0 ? "0" + minutes : minutes // Pad minutes only if hours are present
    const paddedSecs = secs < 10 ? "0" + secs : secs

    if (hours > 0) {
      // Pad hours with leading zero if less than 10 (optional, but common)
      const paddedHours = hours < 10 ? "0" + hours : hours
      return `${paddedHours}:${paddedMinutes}:${paddedSecs}`
    } else {
      return `${minutes}:${paddedSecs}` // Return MM:SS format if no hours
    }
  }

  /**
   * Formats file size from bytes into a human-readable string (e.g., 10.5 KB, 2.3 MB, 1.1 GB).
   * @param {number} bytes - The file size in bytes.
   * @returns {string} Formatted file size string.
   */
  function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined || bytes === 0) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    let i = 0
    // Divide by 1024 until the value is less than 1024 or we reach the last unit
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024
      i++
    }
    // Format the number, ensuring integer if it's a whole number after division
    if (Number.isInteger(bytes)) {
      return `${bytes} ${units[i]}`
    }
    return `${bytes.toFixed(2)} ${units[i]}`
  }
})

/**
 * Changes the background image of the body based on the selected dropdown value.
 * Assumes background images are stored in the 'static/images/' directory.
 */
function changeBackground() {
  const selectedImage = document.getElementById("bgSelect").value
  const body = document.body

  if (selectedImage) {
    // Construct the URL to the image
    body.style.backgroundImage = `url('/static/images/${selectedImage}')`
    // Use 'cover' to scale the image nicely
    body.style.backgroundSize = "cover"
    body.style.backgroundPosition = "center center" // Center the image
    body.style.backgroundRepeat = "no-repeat" // Prevent repeating
    body.style.backgroundAttachment = "fixed" // Keep background fixed during scroll
  } else {
    // If 'None' is selected, remove the background image
    body.style.backgroundImage = "none"
    body.style.backgroundColor = "#f8f9fa" // Set a fallback background color
  }
}
