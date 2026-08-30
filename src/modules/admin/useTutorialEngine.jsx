/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: admin | Déclaration(s): useTutorialEngine */


function useTutorialEngine(setCurrentTab, setSidebarOpen) {
            const startTutorial = React.useCallback((tutorial, profileId) => {
                if (typeof window.driver === 'undefined' || !window.driver?.js?.driver) {
                    alert('Le module de tutoriel est en cours de chargement. Veuillez réessayer.');
                    return;
                }

                const driverInstance = window.driver.js.driver({
                    showProgress: true,
                    animate: true,
                    overlayOpacity: 0.6,
                    stagePadding: 8,
                    stageRadius: 12,
                    popoverOffset: 12,
                    showButtons: ['next', 'previous', 'close'],
                    nextBtnText: 'Suivant',
                    prevBtnText: 'Précédent',
                    doneBtnText: 'Terminer',
                    progressText: 'Étape {{current}} sur {{total}}',
                    onDestroyStarted: () => {
                        if (!driverInstance.hasNextStep()) {
                            localStorage.setItem('tutorial_done_' + profileId + '_' + tutorial.id, '1');
                        }
                        driverInstance.destroy();
                    },
                });

                // Build driver steps with navigation hooks
                const steps = tutorial.steps.map(step => ({
                    element: step.element,
                    popover: {
                        title: step.popover.title,
                        description: step.popover.description,
                        side: step.popover.side || 'bottom',
                        align: 'start',
                    },
                    onHighlightStarted: () => {
                        // Navigate to required tab
                        if (step.requiredTab) {
                            setCurrentTab(step.requiredTab);
                            localStorage.setItem('lastTab', step.requiredTab);
                        }
                        // Open sidebar on mobile for nav steps
                        if (step.element && step.element.includes('nav-') && window.innerWidth < 900) {
                            setSidebarOpen(true);
                        }
                    },
                }));

                // Delay start slightly to allow for any needed navigation
                const firstStep = tutorial.steps[0];
                if (firstStep.requiredTab) {
                    setCurrentTab(firstStep.requiredTab);
                    localStorage.setItem('lastTab', firstStep.requiredTab);
                }

                // Use requestAnimationFrame chain to ensure DOM is ready
                const startDrive = () => {
                    driverInstance.setSteps(steps);
                    driverInstance.drive();
                };

                // Wait for DOM update after tab switch
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        // Check if element exists, if not wait a bit more
                        const firstEl = document.querySelector(steps[0].element);
                        if (firstEl) {
                            startDrive();
                        } else {
                            setTimeout(startDrive, 300);
                        }
                    });
                });
            }, [setCurrentTab, setSidebarOpen]);

            return { startTutorial };
        }

export { useTutorialEngine };
