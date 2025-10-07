document.addEventListener('DOMContentLoaded', function() {
  const handleInput = document.getElementById('handleInput');
  const fetchButton = document.getElementById('fetchButton');
  const resultsDiv = document.getElementById('results');
  const clearCacheButton = document.getElementById('clearCacheButton');

  // Tab elements
  const tabLinks = document.querySelectorAll('.tab-link');
  const tabContents = document.querySelectorAll('.tab-content');

  // Timer elements
  const timerDisplay = document.getElementById('timer');
  const startTimerBtn = document.getElementById('startTimer');
  const pauseTimerBtn = document.getElementById('pauseTimer');
  const resetTimerBtn = document.getElementById('resetTimer');

  // Virtual Contest elements
  const contestSelect = document.getElementById('contest-select');
  const startVirtualContestBtn = document.getElementById('start-virtual-contest');
  const virtualContestProblemsDiv = document.getElementById('virtual-contest-problems');

  // Virtual History elements
  const virtualHistoryResultsDiv = document.getElementById('virtual-history-results');

  let timerInterval;
  let seconds = 0;
  let isRunning = false;
  let isVirtualContest = false;

  // Function to open a tab
  function openTab(tabId) {
    tabContents.forEach(content => content.classList.remove('active'));
    tabLinks.forEach(link => link.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    chrome.storage.local.set({activeTab: tabId});

    if (tabId === 'virtual-history-tab') {
      displayVirtualHistory();
    }
  }

  // Event listeners for tabs
  tabLinks.forEach(link => {
    link.addEventListener('click', () => {
      const tabId = link.getAttribute('data-tab');
      openTab(tabId);
    });
  });

  // Load active tab from storage
  chrome.storage.local.get(['activeTab'], function(result) {
    if (result.activeTab) {
      openTab(result.activeTab);
    } else {
      openTab('timer-tab'); // Default to timer tab
    }
  });

  // Load timer state from storage
  chrome.storage.local.get(['timerState'], function(result) {
    if (result.timerState) {
      seconds = result.timerState.seconds;
      isRunning = result.timerState.isRunning;
      isVirtualContest = result.timerState.isVirtualContest;
      updateTimerDisplay();
      if (isRunning) {
        startTimer();
      }
    }
  });

  function updateTimerDisplay() {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    timerDisplay.textContent = 
      `${hours.toString().padStart(2, '0')}:` + 
      `${minutes.toString().padStart(2, '0')}:` + 
      `${secs.toString().padStart(2, '0')}`;
  }

  function saveTimerState() {
    chrome.storage.local.set({timerState: {seconds, isRunning, isVirtualContest}});
  }

  function startTimer(duration = null) {
    if (isRunning) return;
    if (duration) {
      seconds = duration;
      isVirtualContest = true;
    }
    isRunning = true;
    timerInterval = setInterval(() => {
      if (isVirtualContest) {
        seconds--;
        if (seconds <= 0) {
          pauseTimer();
          seconds = 0;
        }
      } else {
        seconds++;
      }
      updateTimerDisplay();
      saveTimerState();
    }, 1000);
    startTimerBtn.disabled = true;
    pauseTimerBtn.disabled = false;
  }

  function pauseTimer() {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(timerInterval);
    saveTimerState();
    startTimerBtn.disabled = false;
    pauseTimerBtn.disabled = true;
  }

  function resetTimer() {
    pauseTimer();
    seconds = 0;
    isVirtualContest = false;
    updateTimerDisplay();
    saveTimerState();
  }

  startTimerBtn.addEventListener('click', () => startTimer());
  pauseTimerBtn.addEventListener('click', pauseTimer);
  resetTimerBtn.addEventListener('click', resetTimer);

  // Virtual Contest Logic
  async function fetchContestList() {
    try {
      const response = await fetch('https://codeforces.com/api/contest.list?gym=false');
      const data = await response.json();
      if (data.status === 'OK') {
        const contests = data.result.filter(c => c.phase === 'FINISHED');
        contestSelect.innerHTML = contests.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      }
    } catch (error) {
      console.error('Error fetching contest list:', error);
    }
  }

  startVirtualContestBtn.addEventListener('click', async () => {
    const contestId = contestSelect.value;
    const contestName = contestSelect.options[contestSelect.selectedIndex].text;
    try {
      const response = await fetch(`https://codeforces.com/api/contest.standings?contestId=${contestId}&count=1`);
      const data = await response.json();
      if (data.status === 'OK') {
        const contest = data.result.contest;
        const problems = data.result.problems;
        startTimer(contest.durationSeconds);
        openTab('timer-tab');
        virtualContestProblemsDiv.innerHTML = `<h2>${contest.name}</h2><ul>` + 
          problems.map(p => `<li><a href="https://codeforces.com/contest/${contestId}/problem/${p.index}" target="_blank">${p.index} - ${p.name}</a></li>`).join('') + 
          '</ul>';

        // Save virtual contest to storage
        chrome.storage.local.get(['virtualContests'], function(result) {
          const virtualContests = result.virtualContests || [];
          virtualContests.push({
            id: contestId,
            name: contestName,
            startTime: Date.now(),
            duration: contest.durationSeconds
          });
          chrome.storage.local.set({virtualContests: virtualContests});
        });
      }
    } catch (error) {
      console.error('Error starting virtual contest:', error);
    }
  });

  fetchContestList();

  // Virtual History Logic
  async function displayVirtualHistory() {
    virtualHistoryResultsDiv.innerHTML = '<div class="loader"></div>';
    chrome.storage.local.get(['handle', 'virtualContests'], async function(result) {
      const handle = result.handle;
      const virtualContests = result.virtualContests || [];

      if (!handle) {
        virtualHistoryResultsDiv.innerHTML = '<div class="error">Please set your Codeforces handle in the Contest Analysis tab.</div>';
        return;
      }

      if (virtualContests.length === 0) {
        virtualHistoryResultsDiv.innerHTML = '<div>No virtual contests found.</div>';
        return;
      }

      try {
        const submissionsResponse = await fetch(`https://codeforces.com/api/user.status?handle=${handle}`);
        const submissionsData = await submissionsResponse.json();

        if (submissionsData.status !== 'OK') {
          throw new Error(submissionsData.comment);
        }

        const submissions = submissionsData.result;
        let html = '';

        for (const vc of virtualContests) {
          const endTime = vc.startTime + (vc.duration * 1000);
          const solvedProblems = new Set();

          for (const sub of submissions) {
            const subTime = sub.creationTimeSeconds * 1000;
            if (sub.verdict === 'OK' && sub.problem.contestId == vc.id && subTime >= vc.startTime && subTime <= endTime) {
              solvedProblems.add(sub.problem.index);
            }
          }

          html += `
            <div class="contest">
              <h2>${vc.name}</h2>
              <div class="problems">
                <div class="solved-during">
                  <h3>Solved During Virtual Contest</h3>
                  <ul>
                    ${[...solvedProblems].sort().map(id => `<li>${id}</li>`).join('')}
                  </ul>
                </div>
              </div>
            </div>
          `;
        }
        virtualHistoryResultsDiv.innerHTML = html;
      } catch (error) {
        virtualHistoryResultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
      }
    });
  }

  // Contest Analysis Logic
  chrome.storage.local.get(['handle'], function(result) {
    if (result.handle) {
      handleInput.value = result.handle;
      fetchContestData(result.handle);
    }
  });

  fetchButton.addEventListener('click', function() {
    const handle = handleInput.value.trim();
    if (handle) {
      chrome.storage.local.set({handle: handle});
      fetchContestData(handle);
    }
  });

  clearCacheButton.addEventListener('click', function() {
    chrome.storage.local.clear(function() {
      resultsDiv.innerHTML = 'Cache cleared.';
    });
  });

  async function fetchContestData(handle) {
    resultsDiv.innerHTML = '<div class="loader"></div>';
    fetchButton.disabled = true;

    try {
      const cachedData = await getCachedData(handle);
      if (cachedData) {
        displayResults(cachedData);
        return;
      }

      const contestsResponse = await fetch(`https://codeforces.com/api/user.rating?handle=${handle}`);
      if (!contestsResponse.ok) {
        throw new Error(`HTTP error! status: ${contestsResponse.status}`);
      }
      const contestsData = await contestsResponse.json();

      if (contestsData.status !== 'OK') {
        if (contestsData.comment.includes('handle not found')) {
          throw new Error(`Invalid handle: ${handle}`);
        }
        throw new Error(contestsData.comment);
      }

      const submissionsResponse = await fetch(`https://codeforces.com/api/user.status?handle=${handle}`);
      if (!submissionsResponse.ok) {
        throw new Error(`HTTP error! status: ${submissionsResponse.status}`);
      }
      const submissionsData = await submissionsResponse.json();

      if (submissionsData.status !== 'OK') {
        throw new Error(submissionsData.comment);
      }

      const contests = contestsData.result.reverse();
      const submissions = submissionsData.result;

      const contestMap = new Map();

      for (const contest of contests) {
        contestMap.set(contest.contestId, {
          contestName: contest.contestName,
          solvedDuring: new Set(),
          solvedAfter: new Set(),
          allProblems: [],
        });
      }

      for (const submission of submissions) {
        if (submission.verdict === 'OK') {
          const contestId = submission.problem.contestId;
          if (contestMap.has(contestId)) {
            const problemId = submission.problem.index;
            const problemLink = `https://codeforces.com/contest/${contestId}/problem/${problemId}`;
            if (submission.author.participantType === 'CONTESTANT') {
              contestMap.get(contestId).solvedDuring.add({id: problemId, link: problemLink});
            } else if (submission.author.participantType === 'PRACTICE') {
              contestMap.get(contestId).solvedAfter.add({id: problemId, link: problemLink});
            }
          }
        }
      }

      // Fetch all problems for the 15 most recent contests
      const recentContests = contests.slice(0, 15);
      for (const contest of recentContests) {
        const contestId = contest.contestId;
        const standingsResponse = await fetch(`https://codeforces.com/api/contest.standings?contestId=${contestId}&count=1`);
        if (standingsResponse.ok) {
          const standingsData = await standingsResponse.json();
          if (standingsData.status === 'OK') {
            const problems = standingsData.result.problems;
            contestMap.get(contestId).allProblems = problems.map(p => ({id: p.index, link: `https://codeforces.com/contest/${contestId}/problem/${p.index}`}));
          }
        }
      }

      const dataToCache = {
        timestamp: Date.now(),
        data: Array.from(contestMap.entries()).map(([key, value]) => {
          value.solvedDuring = Array.from(value.solvedDuring);
          value.solvedAfter = Array.from(value.solvedAfter);
          return [key, value];
        })
      };

      chrome.storage.local.set({[handle]: dataToCache});

      displayResults(contestMap);
    } catch (error) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
    } finally {
      fetchButton.disabled = false;
    }
  }

  function displayResults(contestMap) {
    let html = '';
    const contestKeys = Array.from(contestMap.keys());
    for (const contestId of contestKeys) {
      const data = contestMap.get(contestId);
      const solvedIds = new Set([...data.solvedDuring, ...data.solvedAfter].map(p => p.id));
      const unsolvedProblems = data.allProblems.filter(p => !solvedIds.has(p.id));

      html += `
        <div class="contest">
          <h2>${data.contestName}</h2>
          <div class="problems">
            <div class="solved-during">
              <h3>Solved During Contest</h3>
              <ul>
                ${[...data.solvedDuring].sort((a, b) => a.id.localeCompare(b.id)).map(problem => `<li><a href="${problem.link}" target="_blank">${problem.id}</a></li>`).join('')}
              </ul>
            </div>
            <div class="solved-after">
              <h3>Solved After Contest</h3>
              <ul>
                ${[...data.solvedAfter].sort((a, b) => a.id.localeCompare(b.id)).map(problem => `<li><a href="${problem.link}" target="_blank">${problem.id}</a></li>`).join('')}
              </ul>
            </div>
          </div>
          ${unsolvedProblems.length > 0 ? `
          <div class="next-problems">
            <h3>Next Problems to Solve</h3>
            <ul>
              ${unsolvedProblems.map(problem => `<li><a href="${problem.link}" target="_blank">${problem.id}</a></li>`).join('')}
            </ul>
          </div>
          ` : ''}
        </div>
      `;
    }
    resultsDiv.innerHTML = html;
  }

  async function getCachedData(handle) {
    return new Promise((resolve) => {
      chrome.storage.local.get([handle], function(result) {
        if (result[handle]) {
          const diff = (Date.now() - result[handle].timestamp) / 1000 / 60;
          if (diff < 60) { // Cache for 60 minutes
            const contestMap = new Map(result[handle].data.map(([key, value]) => {
              value.solvedDuring = new Set(value.solvedDuring.map(p => ({id: p.id, link: p.link})));
              value.solvedAfter = new Set(value.solvedAfter.map(p => ({id: p.id, link: p.link})));
              return [key, value];
            }));
            resolve(contestMap);
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
  }
});
