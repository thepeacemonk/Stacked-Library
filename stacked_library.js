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
         /* Hide native list items, headers, filters, and huge virtual spacers */
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
    };

    async function getPlaylistsRecursively(items) {
        let results = [];
        const folderPromises = [];

        for (const item of items) {
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
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/heart.svg" width="48" height="48" style="filter: invert(1); opacity: 0.9;" />`;
        } else if (uri === "spotify:collection:local-files") {
            cover.style.background = "linear-gradient(135deg, #1db954, #191414)";
            cover.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: white; opacity: 0.9;"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path><path d="M12 11v5"></path><circle cx="10.5" cy="16.5" r="1.5"></circle><path d="M12 11l3-1v4"></path></svg>`;
        } else if (typeClass.includes("sl-folder")) {
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/folder.svg" width="48" height="48" style="filter: invert(1); opacity: 0.85;" />`;
        } else if (typeClass.includes("sl-group-artists")) {
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/mic-2.svg" width="48" height="48" style="filter: invert(59%) sepia(72%) saturate(400%) hue-rotate(95deg) brightness(95%) contrast(90%);" />`;
        } else if (typeClass.includes("sl-group-albums")) {
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/disc-3.svg" width="48" height="48" style="filter: invert(59%) sepia(72%) saturate(400%) hue-rotate(95deg) brightness(95%) contrast(90%);" />`;
        } else if (typeClass.includes("sl-group-playlists")) {
            cover.innerHTML = `<img src="https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/list-music.svg" width="48" height="48" style="filter: invert(59%) sepia(72%) saturate(400%) hue-rotate(95deg) brightness(95%) contrast(90%);" />`;
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
            return res.items || [];
        } catch (e) {
            console.error(e);
            return [];
        }
    }

    function renderHeader(container) {
        container.innerHTML = "";
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
                state.folderItems = res.items || [];
            } catch (e) {
                console.error("Failed to fetch folder items:", e);
                state.folderItems = [];
            }
        }

        renderHeader(rootContainer);

        const grid = document.createElement("div");
        grid.id = "stacked-library-grid";
        rootContainer.appendChild(grid);

        const folders = state.items.filter(i => i.type === "folder" || i.type === "playlist-folder");
        const artists = state.items.filter(i => i.type === "artist");
        const albums = state.items.filter(i => i.type === "album");
        let playlists = state.allPlaylists.filter(i => {
            if (i.type !== "playlist") return false;

            const n = i.name ? i.name.toLowerCase().trim() : "";
            const uri = i.uri || "";

            if (uri.includes("spotify:station:ai") || uri.includes("spotify:ai-dj")) return false;
            if (n === "dj" || n === "ai dj" || n === "dj ai" || n === "spotify dj" || n === "tu dj" || n === "your dj") return false;

            if (i.owner?.name === "Spotify" && (n.startsWith("dj ") || n.endsWith(" dj"))) return false;

            return true;
        }); // Hide AI DJ

        // Remove them to ensure no duplicates if returned by API
        playlists = playlists.filter(p => p.uri !== "spotify:collection:tracks" && p.uri !== "spotify:collection:local-files");

        // Inject them so they are first
        playlists.unshift(
            {
                uri: "spotify:collection:tracks",
                name: "Liked Songs",
                type: "collection",
                owner: { name: "Spotify" }
            },
            {
                uri: "spotify:collection:local-files",
                name: "Local Files",
                type: "collection",
                owner: { name: "Spotify" }
            }
        );

        if (state.view === "ROOT") {
            // 1. Artists Group (Yellow)
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

    // Re-render when library updates
    try {
        Spicetify.Platform.LibraryAPI.getEvents?.()?.addListener?.("update", async () => {
            state.items = await fetchLibrary();
            state.allPlaylists = await getPlaylistsRecursively(state.items);
            render();
        });
    } catch (e) { }

})();
