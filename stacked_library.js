/**
 * Stacked Library Extension for Spicetify
 * Groups Artists, Albums, and Playlists into big cards at the bottom of Folders.
 */

(async function StackedLibrary() {
    if (!Spicetify?.Platform?.LibraryAPI || !Spicetify?.Platform?.History) {
        setTimeout(StackedLibrary, 300);
        return;
    }

    const STYLE_ID = "stacked-library-styles";
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
         /* Always hide native list items, headers, filters, and huge virtual spacers */
         .main-yourLibraryX-libraryContainer [role="list"],
         .main-yourLibraryX-libraryContainer [role="grid"],
         .main-yourLibraryX-libraryContainer [role="tree"],
         .main-yourLibraryX-libraryContainer ul,
         .main-yourLibraryX-header,
         .main-useCaseFilter-filterSpace,
         .main-yourLibraryX-filterArea,
         .main-yourLibraryX-libraryFilter {
              display: none !important;
         }
         
         /* Hide the virtual spacer div that pushes our grid down */
         .main-yourLibraryX-libraryContainer .os-content > *:not(#stacked-library-root),
         .main-yourLibraryX-libraryContainer [data-overlayscrollbars-contents] > *:not(#stacked-library-root) {
              display: none !important;
         }

         /* When collapsed, we show out custom grid as a single column and hide the texts */
         body.sl-collapsed #stacked-library-grid {
              grid-template-columns: 1fr !important;
              padding: 16px 8px 24px !important;
         }
         
         body.sl-collapsed .sl-title,
         body.sl-collapsed .sl-subtitle,
         body.sl-collapsed #stacked-library-topbar {
              display: none !important;
         }

         #stacked-library-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              grid-auto-rows: min-content;
              gap: 16px;
              padding: 16px 16px 24px;
              width: 100%;
              box-sizing: border-box;
         }

         .sl-card {
              display: flex;
              flex-direction: column;
              align-items: center;
              cursor: pointer;
              background: transparent;
              border: none;
              padding: 0;
              min-width: 0;
              transition: transform 0.2s ease, filter 0.2s ease;
         }
         .sl-card:hover {
              transform: scale(1.05);
              filter: brightness(1.2);
         }

         .sl-cover {
              width: 100%;
              aspect-ratio: 1 / 1;
              border-radius: 8px;
              object-fit: cover;
              background-color: var(--spice-elevated-base, #282828);
              box-shadow: 0 8px 24px rgba(0,0,0,0.5);
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
         }
         
         .sl-cover.sl-artist { border-radius: 50%; } /* Artists are circles */
         .sl-cover.sl-folder { border-radius: 12px; } /* Default dark background */

         /* The Three Group Cards at bottom */
         .sl-group-artists, .sl-group-albums, .sl-group-playlists {
              width: 100%;
              aspect-ratio: 1 / 1;
              border-radius: 12px;
              color: var(--spice-button, #1db954); /* Spotify Green for icons */
         }

         .sl-title {
              margin-top: 12px;
              font-size: 14px;
              font-weight: 700;
              color: var(--spice-text, #fff);
              text-align: center;
              width: 100%;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
         }

         .sl-subtitle {
              margin-top: 4px;
              font-size: 13px;
              color: var(--spice-subtext, #b3b3b3);
              text-align: center;
              width: 100%;
         }

         /* Inner View Header */
         #stacked-library-header {
              display: flex;
              align-items: center;
              padding: 16px;
              gap: 12px;
         }
         .sl-back-btn {
              background: transparent;
              border: none;
              color: var(--spice-subtext, #b3b3b3);
              cursor: pointer;
              border-radius: 50%;
              padding: 8px;
              display: flex;
              align-items: center;
              justify-content: center;
         }
         .sl-back-btn:hover {
              color: var(--spice-text, #fff);
              background: rgba(255,255,255,0.1);
         }
         .sl-header-title {
              font-size: 24px;
              font-weight: 700;
              color: var(--spice-text, #fff);
         }
         `;
        document.head.appendChild(style);
    }

    // Context tracking state
    let state = {
        view: "ROOT", // ROOT, ARTISTS, ALBUMS, PLAYLISTS, FOLDER
        currentFolder: null,
        items: [],
        folderItems: [],
        allPlaylists: [],
        filterOwn: false,
        sortAlpha: false,
        searchQuery: "",
    };

    function isHidden(item) {
        if (!item) return true;
        const n = item.name ? item.name.toLowerCase().trim() : "";
        const uri = item.uri || "";

        // Completely ignore items with no explicit URI (except local/liked system folders if they lack it briefly, which they shouldn't)
        if (!uri) return true;

        // Hide pseudo-empty items that appear as 'Unknown'
        if (!item.name && !item.owner) return true;

        if (uri.includes("spotify:station:ai") || uri.includes("spotify:ai-dj")) return true;

        // Also block the specific known AI DJ playlist ID
        if (uri.includes("37i9dQZF1EYkqdzj48dyYq")) return true;

        if (n === "dj" || n === "ai dj" || n === "dj ai" || n === "spotify dj" || n === "tu dj" || n === "your dj") return true;
        if (item.owner?.name === "Spotify" && (n.startsWith("dj ") || n.endsWith(" dj"))) return true;

        return false;
    }

    async function getPlaylistsRecursively(items) {
        let results = [];
        const folderPromises = [];

        for (const item of items) {
            if (isHidden(item)) continue;
            if (item.type === "playlist") {
                results.push(item);
            } else if (item.type === "folder" || item.type === "playlist-folder") {
                folderPromises.push(
                    Spicetify.Platform.LibraryAPI.getContents({ limit: 5000, offset: 0, folderUri: item.uri })
                        .then(res => res.items ? getPlaylistsRecursively(res.items) : [])
                        .catch(e => {
                            console.error("Failed to fetch nested folder:", e);
                            return [];
                        })
                );
            }
        }

        const foldersContents = await Promise.all(folderPromises);
        for (const content of foldersContents) {
            results.push(...content);
        }

        // Deduplicate by URI
        const seen = new Set();
        return results.filter(p => {
            if (seen.has(p.uri)) return false;
            seen.add(p.uri);
            return true;
        });
    }

    function navigate(uri) {
        if (!uri) return;
        const parts = uri.split(":");
        if (parts.length >= 3) {
            const type = parts[1];
            const id = parts.slice(2).join(":");
            if (type === "folder") {
                Spicetify.Platform.History.push("/folder/" + id);
            } else if (type === "playlist") {
                Spicetify.Platform.History.push("/playlist/" + id);
            } else if (type === "artist") {
                Spicetify.Platform.History.push("/artist/" + id);
            } else if (type === "album") {
                Spicetify.Platform.History.push("/album/" + id);
            } else {
                Spicetify.Platform.History.push("/" + type + "/" + id);
            }
        }
    }

    function getImageUrl(item) {
        const url = item.images?.[0]?.url || item.image || item.imgUrl || item.picture || item.image_url || item.covers?.default;
        if (!url) return "";

        if (url.startsWith("spotify:image:")) return "https://i.scdn.co/image/" + url.split(":")[2];
        if (url.startsWith("spotify:mosaic:")) return "https://mosaic.scdn.co/640/" + url.split(":")[2];

        return url;
    }

    function scrollToTop() {
        const libraryContainer = document.querySelector(".main-yourLibraryX-libraryContainer");
        if (!libraryContainer) return;
        const scrollViewport = libraryContainer.querySelector('.os-viewport') ||
            libraryContainer.querySelector('[data-overlayscrollbars-viewport]') ||
            libraryContainer;
        if (scrollViewport.scrollTo) {
            scrollViewport.scrollTo({ top: 0, behavior: "auto" });
        } else {
            scrollViewport.scrollTop = 0;
        }
    }

    // Open a Spotify-style rename modal, then call the best available API to rename the folder.
    function promptRename(e, uri) {
        if (!e) return;

        // Find the current folder name
        let oldName = "";
        const item = state.items.find(i => i.uri === uri) || state.folderItems.find(i => i.uri === uri);
        if (item) oldName = item.name;
        if (!oldName && state.currentFolder && state.currentFolder.uri === uri) oldName = state.currentFolder.name;

        const { React, ReactDOM, PopupModal } = Spicetify;
        if (!React || !PopupModal) {
            const newName = window.prompt("Rename folder:", oldName);
            if (newName && newName.trim() && newName !== oldName) executeRename(uri, newName.trim());
            return;
        }

        // Build a Spotify-style React form modal
        const container = document.createElement("div");

        function RenameModal() {
            const [value, setValue] = React.useState(oldName);
            const inputRef = React.useRef(null);

            React.useEffect(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.select();
                }
            }, []);

            const submit = (ev) => {
                ev.preventDefault();
                const trimmed = value.trim();
                if (trimmed && trimmed !== oldName) {
                    PopupModal.hide();
                    executeRename(uri, trimmed);
                } else {
                    PopupModal.hide();
                }
            };

            return React.createElement("div", { style: { padding: "0 4px 4px" } },
                React.createElement("form", { onSubmit: submit },
                    React.createElement("input", {
                        ref: inputRef,
                        type: "text",
                        value: value,
                        onChange: ev => setValue(ev.target.value),
                        onKeyDown: ev => { if (ev.key === "Escape") PopupModal.hide(); },
                        style: {
                            display: "block",
                            width: "100%",
                            padding: "10px 12px",
                            background: "var(--spice-main-elevated, #2a2a2a)",
                            border: "2px solid var(--spice-button, #1db954)",
                            borderRadius: "4px",
                            color: "var(--spice-text, #fff)",
                            fontSize: "14px",
                            fontFamily: "inherit",
                            outline: "none",
                            boxSizing: "border-box",
                            marginBottom: "16px"
                        }
                    }),
                    React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px" } },
                        React.createElement("button", {
                            type: "button",
                            onClick: () => PopupModal.hide(),
                            style: {
                                padding: "8px 20px", background: "transparent",
                                color: "var(--spice-subtext, #b3b3b3)", border: "1px solid var(--spice-button-disabled, #555)",
                                borderRadius: "500px", cursor: "pointer", fontSize: "13px", fontWeight: "700", fontFamily: "inherit"
                            }
                        }, "Cancel"),
                        React.createElement("button", {
                            type: "submit",
                            style: {
                                padding: "8px 20px", background: "var(--spice-button, #1db954)",
                                color: "#000", border: "none", borderRadius: "500px",
                                cursor: "pointer", fontSize: "13px", fontWeight: "700", fontFamily: "inherit"
                            }
                        }, "Save")
                    )
                )
            );
        }

        PopupModal.display({
            title: "Rename folder",
            content: React.createElement(RenameModal, null),
            isLarge: false
        });
    }

    async function executeRename(uri, newName) {
        const rootlistApi = Spicetify.Platform?.RootlistAPI;

        try {
            // Signature confirmed: renameFolder(e, t) where e.uri is the folder URI and t is the new name
            await rootlistApi.renameFolder({ uri }, newName);

            setTimeout(async () => {
                state.items = await fetchLibrary();
                state.allPlaylists = await getPlaylistsRecursively(state.items);
                if (state.currentFolder?.uri === uri) state.currentFolder.name = newName;
                render();
            }, 800);
            Spicetify.showNotification(`Renamed to "${newName}"`);
        } catch (e) {
            console.error("[rename] renameFolder failed:", e);
            Spicetify.showNotification(`Rename failed: ${e.message}`, false, 4000);
        }
    }

    function createCard(title, subtitle, coverUrl, typeClass, onClick, onLongPress, uri) {
        const card = document.createElement("div");
        card.className = "sl-card";
        if (uri) {
            card.setAttribute("data-contextmenu", "");
            card.setAttribute("data-uri", uri);
        }

        let isLongPress = false;
        if (onLongPress) {
            let pressTimer;
            const startPress = (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                isLongPress = false;
                pressTimer = setTimeout(() => {
                    isLongPress = true;
                    onLongPress(e);
                }, 400); // Reduced delay slightly so it feels more responsive
            };
            const cancelPress = () => clearTimeout(pressTimer);

            card.addEventListener('pointerdown', startPress);
            card.addEventListener('pointerup', cancelPress);
            card.addEventListener('pointerleave', cancelPress);
            card.addEventListener('pointercancel', cancelPress);
            card.addEventListener('contextmenu', cancelPress);
        }

        card.onclick = (e) => {
            if (!isLongPress && onClick) {
                onClick(e);
            }
        };

        // Also capture normal right clicks on our custom element and prevent default context menu 
        // if Spotify isn't catching it automatically, we can optionally dispatch it.
        // Actually, let Spotify catch it naturally by allowing bubble if it happens, or redirect 
        // to a programmatic one if `onLongPress` is provided
        if (onLongPress) {
            card.addEventListener("contextmenu", (e) => {
                // Try to force Spotify to handle it if it isn't already
                // Optional, usually Spotify handles ContextMenu globally, but since we are deeply 
                // appending to os-content, we might be out of React's direct event pool.
                // The long press logic dispatches the fake context menu here anyway, which bubbling will catch.
            });
        }

        const cover = document.createElement("div");
        cover.className = "sl-cover " + typeClass;

        if (coverUrl) {
            cover.style.backgroundImage = `url(${coverUrl})`;
            cover.style.backgroundSize = "cover";
            cover.style.backgroundPosition = "center";
        } else if (uri === "spotify:collection:tracks") {
            cover.style.background = "linear-gradient(135deg, #450af5, #c4efd9)";
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/heart.svg" style="width: 50%; height: 50%; filter: invert(1); opacity: 0.9;" />`;
        } else if (uri === "spotify:collection:local-files") {
            cover.style.background = "linear-gradient(135deg, #1db954, #191414)";
            cover.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 50%; height: 50%; color: white; opacity: 0.9;"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path><path d="M12 11v5"></path><circle cx="10.5" cy="16.5" r="1.5"></circle><path d="M12 11l3-1v4"></path></svg>`;
        } else if (typeClass.includes("sl-folder")) {
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/folder.svg" style="width: 50%; height: 50%; filter: invert(1); opacity: 0.85;" />`;
        } else if (typeClass.includes("sl-group-artists")) {
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/mic-2.svg" style="width: 50%; height: 50%; filter: invert(59%) sepia(72%) saturate(400%) hue-rotate(95deg) brightness(95%) contrast(90%);" />`;
        } else if (typeClass.includes("sl-group-albums")) {
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/disc-3.svg" style="width: 50%; height: 50%; filter: invert(59%) sepia(72%) saturate(400%) hue-rotate(95deg) brightness(95%) contrast(90%);" />`;
        } else if (typeClass.includes("sl-group-playlists")) {
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/list-music.svg" style="width: 50%; height: 50%; filter: invert(59%) sepia(72%) saturate(400%) hue-rotate(95deg) brightness(95%) contrast(90%);" />`;
        }

        const titleEl = document.createElement("div");
        titleEl.className = "sl-title";
        titleEl.textContent = title;

        const subEl = document.createElement("div");
        subEl.className = "sl-subtitle";
        subEl.textContent = subtitle;

        card.appendChild(cover);
        card.appendChild(titleEl);
        if (subtitle) card.appendChild(subEl);

        return card;
    }

    async function fetchLibrary() {
        try {
            const res = await Spicetify.Platform.LibraryAPI.getContents({ limit: 5000, offset: 0 });
            return (res.items || []).filter(i => !isHidden(i));
        } catch (e) {
            console.error(e);
            return [];
        }
    }

    function renderHeader(container) {
        container.innerHTML = "";

        // Render Top Bar with Filters
        const topbar = document.createElement("div");
        topbar.id = "stacked-library-topbar";
        topbar.style.display = "flex";
        topbar.style.gap = "8px";
        topbar.style.padding = "16px 16px 0 16px";
        topbar.style.alignItems = "center";
        topbar.style.flexWrap = "wrap";

        const createPill = (label, isActive, onClick) => {
            const btn = document.createElement("button");
            btn.textContent = label;
            btn.style.borderRadius = "32px";
            btn.style.padding = "6px 14px";
            btn.style.fontSize = "13px";
            btn.style.fontWeight = "700";
            btn.style.border = "none";
            btn.style.cursor = "pointer";
            btn.style.backgroundColor = isActive ? "var(--spice-button, #1db954)" : "var(--spice-main-elevated, #2a2a2a)";
            btn.style.color = isActive ? "#000" : "var(--spice-text, #fff)";
            btn.style.transition = "background-color 0.2s, transform 0.1s";
            if (!isActive) {
                btn.onmouseenter = () => btn.style.backgroundColor = "var(--spice-highlight, #3a3a3a)";
                btn.onmouseleave = () => btn.style.backgroundColor = "var(--spice-main-elevated, #2a2a2a)";
            }
            btn.onclick = onClick;
            return btn;
        };

        topbar.appendChild(createPill("By you", state.filterOwn, () => {
            state.filterOwn = !state.filterOwn;
            render();
        }));

        topbar.appendChild(createPill("Alphabetical", state.sortAlpha, () => {
            state.sortAlpha = !state.sortAlpha;
            render();
        }));

        const searchContainer = document.createElement("div");
        searchContainer.style.position = "relative";
        searchContainer.style.marginLeft = "auto";

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Search...";
        searchInput.value = state.searchQuery || "";
        searchInput.style.borderRadius = "32px";
        searchInput.style.padding = "6px 14px";
        searchInput.style.fontSize = "13px";
        searchInput.style.fontFamily = "inherit";
        searchInput.style.border = "none";
        searchInput.style.backgroundColor = "var(--spice-main-elevated, #2a2a2a)";
        searchInput.style.color = "var(--spice-text, #fff)";
        searchInput.style.outline = "none";
        searchInput.style.width = "120px";
        searchInput.style.boxSizing = "border-box";
        searchInput.style.transition = "background-color 0.2s, width 0.2s";

        searchInput.onmouseenter = () => {
            if (document.activeElement !== searchInput) {
                searchInput.style.backgroundColor = "var(--spice-highlight, #3a3a3a)";
            }
        };
        searchInput.onmouseleave = () => {
            if (document.activeElement !== searchInput) {
                searchInput.style.backgroundColor = "var(--spice-main-elevated, #2a2a2a)";
            }
        };

        searchInput.onfocus = () => {
            searchInput.style.backgroundColor = "var(--spice-highlight, #3a3a3a)";
            searchInput.style.width = "180px";
            updateSearchResults();
        };
        searchInput.onblur = () => {
            searchInput.style.backgroundColor = "var(--spice-main-elevated, #2a2a2a)";
            searchInput.style.width = "120px";
            setTimeout(() => {
                const results = document.getElementById("sl-search-results");
                if (results) results.style.display = "none";
            }, 200);
        };

        searchInput.oninput = (e) => {
            state.searchQuery = e.target.value.toLowerCase();
            updateSearchResults();
        };

        searchContainer.appendChild(searchInput);

        const searchResults = document.createElement("div");
        searchResults.id = "sl-search-results";
        searchResults.style.position = "absolute";
        searchResults.style.top = "100%";
        searchResults.style.left = "auto";
        searchResults.style.right = "0"; // Align to right because it's at the end
        searchResults.style.marginTop = "8px";
        searchResults.style.width = "280px";
        searchResults.style.maxHeight = "400px";
        searchResults.style.overflowY = "auto";
        searchResults.style.backgroundColor = "var(--spice-elevated-base, #282828)";
        searchResults.style.borderRadius = "8px";
        searchResults.style.boxShadow = "0 8px 24px rgba(0,0,0,0.5)";
        searchResults.style.zIndex = "100";
        searchResults.style.display = "none";
        searchResults.style.flexDirection = "column";

        searchResults.style.scrollbarWidth = "none";

        searchContainer.appendChild(searchResults);

        function updateSearchResults() {
            const results = document.getElementById("sl-search-results");
            if (!results) return;
            const q = state.searchQuery;
            if (!q) {
                results.style.display = "none";
                return;
            }
            results.style.display = "flex";
            results.innerHTML = "";

            const albums = state.items.filter(i => i.type === "album" && (i.name || "").toLowerCase().includes(q));

            let allPlaylists = state.allPlaylists.filter(i => i.type === "playlist" && !isHidden(i));
            allPlaylists = allPlaylists.filter(p => !p.uri.includes("collection:tracks") && !p.uri.includes("collection:local-files"));

            allPlaylists.unshift(
                { uri: "spotify:collection:tracks", name: "Liked Songs", type: "collection", owner: { name: "Spotify" } },
                { uri: "spotify:collection:local-files", name: "Local Files", type: "collection", owner: { name: "Spotify" } }
            );
            const playlists = allPlaylists.filter(i => (i.name || "").toLowerCase().includes(q));

            const artists = state.items.filter(i => i.type === "artist" && (i.name || "").toLowerCase().includes(q));

            const createRow = (item, typeLabel) => {
                const row = document.createElement("div");
                row.style.display = "flex";
                row.style.alignItems = "center";
                row.style.padding = "8px 12px";
                row.style.gap = "12px";
                row.style.cursor = "pointer";
                row.style.transition = "background-color 0.2s";

                row.onmouseenter = () => row.style.backgroundColor = "var(--spice-highlight, #3a3a3a)";
                row.onmouseleave = () => row.style.backgroundColor = "transparent";

                row.onmousedown = (e) => {
                    e.preventDefault();
                };

                row.onclick = () => {
                    navigate(item.uri);
                    state.searchQuery = "";
                    searchInput.value = "";
                    results.style.display = "none";
                };

                const imgWrap = document.createElement("div");
                imgWrap.style.width = "40px";
                imgWrap.style.height = "40px";
                imgWrap.style.borderRadius = typeLabel === "Artist" ? "50%" : "4px";
                imgWrap.style.overflow = "hidden";
                imgWrap.style.flexShrink = "0";
                imgWrap.style.backgroundColor = "var(--spice-main-elevated, #2a2a2a)";
                imgWrap.style.display = "flex";
                imgWrap.style.alignItems = "center";
                imgWrap.style.justifyContent = "center";

                let src = getImageUrl(item);
                if (!src && item.uri === "spotify:collection:tracks") {
                    imgWrap.style.background = "linear-gradient(135deg, #450af5, #c4efd9)";
                    imgWrap.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/heart.svg" width="24" height="24" style="filter: invert(1); opacity: 0.9;" />`;
                } else if (!src && item.uri === "spotify:collection:local-files") {
                    imgWrap.style.background = "linear-gradient(135deg, #1db954, #191414)";
                    imgWrap.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: white; opacity: 0.9;"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path><path d="M12 11v5"></path><circle cx="10.5" cy="16.5" r="1.5"></circle><path d="M12 11l3-1v4"></path></svg>`;
                } else if (!src) {
                    imgWrap.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/music.svg" width="20" height="20" style="filter: invert(0.5);" />`;
                } else {
                    const img = document.createElement("img");
                    img.src = src;
                    img.style.width = "100%";
                    img.style.height = "100%";
                    img.style.objectFit = "cover";
                    imgWrap.appendChild(img);
                }

                const info = document.createElement("div");
                info.style.display = "flex";
                info.style.flexDirection = "column";
                info.style.overflow = "hidden";
                info.style.flex = "1";
                info.style.justifyContent = "center";

                const name = document.createElement("span");
                name.style.fontSize = "14px";
                name.style.color = "var(--spice-text, #fff)";
                name.style.whiteSpace = "nowrap";
                name.style.overflow = "hidden";
                name.style.textOverflow = "ellipsis";
                name.textContent = item.name || "Unknown";

                const sub = document.createElement("span");
                sub.style.fontSize = "13px";
                sub.style.color = "var(--spice-subtext, #b3b3b3)";
                sub.style.whiteSpace = "nowrap";
                sub.style.overflow = "hidden";
                sub.style.textOverflow = "ellipsis";

                let subtitle = typeLabel;
                if (item.owner?.name) subtitle += " • " + item.owner.name;
                sub.textContent = subtitle;

                info.appendChild(name);
                info.appendChild(sub);

                row.appendChild(imgWrap);
                row.appendChild(info);

                return row;
            };

            let count = 0;
            const appendItems = (list, label) => {
                for (let item of list) {
                    if (count > 100) break;
                    results.appendChild(createRow(item, label));
                    count++;
                }
            };

            appendItems(albums, "Album");
            appendItems(playlists, "Playlist");
            appendItems(artists, "Artist");

            if (count === 0) {
                const noRes = document.createElement("div");
                noRes.style.padding = "16px";
                noRes.style.color = "var(--spice-subtext, #b3b3b3)";
                noRes.style.fontSize = "14px";
                noRes.style.textAlign = "center";
                noRes.textContent = "No results found";
                results.appendChild(noRes);
            }
        }

        topbar.appendChild(searchContainer);

        container.appendChild(topbar);

        if (state.view !== "ROOT") {
            const header = document.createElement("div");
            header.id = "stacked-library-header";

            const backBtn = document.createElement("button");
            backBtn.className = "sl-back-btn";
            backBtn.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/chevron-left.svg" width="24" height="24" style="filter: invert(1); opacity: 0.75;" />`;
            backBtn.onclick = () => {
                state.view = "ROOT";
                state.currentFolder = null;
                render();
                scrollToTop();
            };

            const title = document.createElement("div");
            title.className = "sl-header-title";
            if (state.view === "FOLDER" && state.currentFolder) {
                title.textContent = state.currentFolder.name;
            } else {
                title.textContent = "All " + state.view.charAt(0) + state.view.slice(1).toLowerCase();
            }

            header.appendChild(backBtn);
            header.appendChild(title);
            container.appendChild(header);
        }
    }

    async function render() {
        const libraryContainer = document.querySelector(".main-yourLibraryX-libraryContainer");
        if (!libraryContainer) {
            setTimeout(render, 500);
            return;
        }

        // Look for the scrollable child usually underneath the virtual list wrapper
        const scrollContainer = libraryContainer.querySelector('.os-content') ||
            libraryContainer.querySelector('[data-overlayscrollbars-contents]') ||
            libraryContainer.querySelector('.os-viewport') ||
            libraryContainer;

        let rootContainer = document.getElementById("stacked-library-root");
        if (!rootContainer) {
            rootContainer = document.createElement("div");
            rootContainer.id = "stacked-library-root";

            // We prepend directly to the content container to be at the true top
            scrollContainer.prepend(rootContainer);
        } else if (rootContainer.parentElement !== scrollContainer) {
            scrollContainer.prepend(rootContainer);
        }

        // Ensure items are fetched
        if (!state.items.length) {
            state.items = await fetchLibrary();
            state.allPlaylists = await getPlaylistsRecursively(state.items);
        }

        if (state.view === "FOLDER" && state.currentFolder) {
            try {
                const res = await Spicetify.Platform.LibraryAPI.getContents({ limit: 5000, offset: 0, folderUri: state.currentFolder.uri });
                state.folderItems = (res.items || []).filter(i => !isHidden(i));
            } catch (e) {
                console.error("Failed to fetch folder items:", e);
                state.folderItems = [];
            }
        }

        renderHeader(rootContainer);

        const grid = document.createElement("div");
        grid.id = "stacked-library-grid";
        rootContainer.appendChild(grid);

        let folders = state.items.filter(i => i.type === "folder" || i.type === "playlist-folder");
        let artists = state.items.filter(i => i.type === "artist");
        let albums = state.items.filter(i => i.type === "album");
        let playlists = state.allPlaylists.filter(i => {
            if (i.type !== "playlist") return false;
            return !isHidden(i);
        }); // Hide AI DJ

        // Remove them to ensure no duplicates if returned by API
        playlists = playlists.filter(p => p.uri !== "spotify:collection:tracks" && p.uri !== "spotify:collection:local-files");

        // Inject them so they are first
        playlists.unshift(
            {
                uri: "spotify:collection:tracks",
                name: "Liked Songs",
                type: "collection",
                owner: { name: "Spotify" },
                isOwnedBySelf: true,
                availableOffline: true // Assume available offline if they want to filter it
            },
            {
                uri: "spotify:collection:local-files",
                name: "Local Files",
                type: "collection",
                owner: { name: "Spotify" },
                isOwnedBySelf: true,
                availableOffline: true
            }
        );

        // Apply filters
        const fallbackUserUri = Spicetify.Platform?.Session?.user?.uri || Spicetify.Platform?.UserAPI?._state?.currentUser?.uri || Spicetify.Session?.User?.uri;
        const fallbackUserName = Spicetify.Platform?.Session?.user?.name || Spicetify.Platform?.Session?.user?.username || Spicetify.Platform?.UserAPI?._state?.currentUser?.name || Spicetify.Platform?.UserAPI?._state?.currentUser?.username || Spicetify.Session?.User?.name || Spicetify.Session?.User?.username;

        const isOwn = (item) => {
            if (item.isOwnedBySelf === true || item.ownedBySelf === true) return true;

            const itemOwnerUri = item.owner?.uri || item.creator?.uri;
            if (fallbackUserUri && itemOwnerUri && itemOwnerUri === fallbackUserUri) return true;

            const itemOwnerName = item.owner?.name || item.creator?.name;
            if (fallbackUserName && itemOwnerName && itemOwnerName === fallbackUserName) return true;

            return false;
        };

        if (state.filterOwn) {
            artists = [];
            albums = [];
            playlists = playlists.filter(isOwn);
            if (state.folderItems) state.folderItems = state.folderItems.filter(i => i.type === "folder" || i.type === "playlist-folder" ? true : isOwn(i));
        }

        if (state.sortAlpha) {
            const sortAlphaFunc = (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true });
            folders.sort(sortAlphaFunc);
            artists.sort(sortAlphaFunc);
            albums.sort(sortAlphaFunc);
            playlists.sort(sortAlphaFunc);
            if (state.folderItems) state.folderItems.sort(sortAlphaFunc);
        }

        if (state.view === "ROOT") {
            // 1. Artists Group (Yellow)
            if (!state.filterOwn) {
                grid.appendChild(createCard(
                    "Artists",
                    artists.length + " artists",
                    null,
                    "sl-group-artists",
                    () => { state.view = "ARTISTS"; render(); scrollToTop(); }
                ));

                // 2. Albums Group (Green)
                grid.appendChild(createCard(
                    "Albums",
                    albums.length + " albums",
                    null,
                    "sl-group-albums",
                    () => { state.view = "ALBUMS"; render(); scrollToTop(); }
                ));
            }

            // 3. Playlists Group (Blue)
            grid.appendChild(createCard(
                "Playlists",
                playlists.length + " playlists",
                null,
                "sl-group-playlists",
                () => { state.view = "PLAYLISTS"; render(); scrollToTop(); }
            ));

            for (const folder of folders) {
                grid.appendChild(createCard(
                    folder.name,
                    "Folder",
                    null,
                    "sl-folder",
                    () => {
                        state.view = "FOLDER";
                        state.currentFolder = { uri: folder.uri, name: folder.name };
                        render();
                        scrollToTop();
                    },
                    (e) => promptRename(e, folder.uri),
                    folder.uri
                ));
            }

        } else {
            // Detailed Views
            let itemsToShow = [];
            let defaultCoverStyle = "";
            if (state.view === "ARTISTS") { itemsToShow = artists; defaultCoverStyle = "sl-artist"; }
            else if (state.view === "ALBUMS") { itemsToShow = albums; defaultCoverStyle = "sl-album"; }
            else if (state.view === "PLAYLISTS") { itemsToShow = playlists; defaultCoverStyle = "sl-playlist"; }
            else if (state.view === "FOLDER") { itemsToShow = state.folderItems; defaultCoverStyle = "sl-playlist"; }

            for (const item of itemsToShow) {
                const isFolder = item.type === "folder" || item.type === "playlist-folder";
                const isArtist = item.type === "artist";
                const isAlbum = item.type === "album";

                let coverStyle = defaultCoverStyle;
                if (isFolder) coverStyle = "sl-folder";
                else if (isArtist) coverStyle = "sl-artist";
                else if (isAlbum) coverStyle = "sl-album";

                const onClick = () => {
                    if (isFolder) {
                        state.view = "FOLDER";
                        state.currentFolder = { uri: item.uri, name: item.name };
                        render();
                        scrollToTop();
                    } else {
                        navigate(item.uri);
                    }
                };

                let subtitle = item.owner?.name;
                if (!subtitle) {
                    if (isFolder) subtitle = "Folder";
                    else if (item.uri === "spotify:collection:tracks") subtitle = "Playlist";
                    else if (item.uri === "spotify:collection:local-files") subtitle = "Local Playlist";
                    else if (item.type) subtitle = item.type.charAt(0).toUpperCase() + item.type.slice(1);
                    else subtitle = "Playlist";
                }

                const initialUrl = getImageUrl(item);
                const card = createCard(
                    item.name || "Unknown",
                    subtitle,
                    initialUrl,
                    coverStyle,
                    onClick,
                    isFolder ? (e) => promptRename(e, item.uri) : undefined,
                    item.uri
                );

                // Fallback for playlists without an explicit cover (inheriting from tracks)
                if (!initialUrl && item.type === "playlist" && item.uri) {
                    (async () => {
                        try {
                            const id = item.uri.split(":").pop();
                            let picture = "";

                            if (Spicetify.CosmosAsync) {
                                // Use the official Web API endpoint which safely resolves mosaics
                                const res = await Spicetify.CosmosAsync.get('https://api.spotify.com/v1/playlists/' + id);
                                if (res?.images && res.images.length > 0) {
                                    picture = res.images[0].url;
                                }
                            }

                            if (picture) {
                                if (picture.startsWith("spotify:image:")) picture = "https://i.scdn.co/image/" + picture.split(":")[2];
                                else if (picture.startsWith("spotify:mosaic:")) picture = "https://mosaic.scdn.co/640/" + picture.split(":")[2];

                                const coverEl = card.querySelector(".sl-cover");
                                if (coverEl) {
                                    coverEl.style.backgroundImage = `url(${picture})`;
                                    coverEl.style.backgroundSize = "cover";
                                    coverEl.style.backgroundPosition = "center";
                                    coverEl.innerHTML = "";
                                }
                            }
                        } catch (e) {
                            console.debug("Failed to fetch fallback cover for", item.uri);
                        }
                    })();
                }

                grid.appendChild(card);
            }
        }
    }

    render();

    let resizeObserver = null;
    function observeSidebar() {
        if (resizeObserver) return;
        const libraryContainer = document.querySelector(".main-yourLibraryX-libraryContainer") || document.querySelector(".Root__nav-bar");
        if (!libraryContainer) {
            setTimeout(observeSidebar, 500);
            return;
        }

        resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.contentRect.width < 150) {
                    document.body.classList.add("sl-collapsed");
                } else {
                    document.body.classList.remove("sl-collapsed");
                }
            }
        });
        resizeObserver.observe(libraryContainer);
    }
    observeSidebar();

    // Re-render when library updates
    try {
        Spicetify.Platform.LibraryAPI.getEvents?.()?.addListener?.("update", async () => {
            state.items = await fetchLibrary();
            state.allPlaylists = await getPlaylistsRecursively(state.items);
            render();
        });
    } catch (e) { }

})();
