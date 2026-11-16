# Make your first comparison

Open [Model Lab](http://127.0.0.1:4317). The dashboard stays empty until you start a run.

1. On **Home**, browse **Available tests**. Open a family to read its tasks and estimated difficulty.
2. Choose **Prepare one call** to start with one model, one task, and one repeat. On **Run**, choose a preset and the included model. Read its harness and effort tags. Select a supported **Thinking effort** if you want to change the preset setting.
3. Press **Preview**. The output lists the exact calls and settings. Preview calls no model and creates no run.
4. When the plan matches your choice, press **Start**, then confirm the displayed call count. This spends your model subscription quota. The progress card shows the running command and **Stop**.
5. After the run, open **Results**. Choose the test and the setups to compare. Use the harness and effort filters to find them. **Graphs** shows quality, time, and usage for the selected setups. **Visual output** shows available visual files. Open an attempt for its answer, check details, and visual output.
6. To compare another model, prepare the same test with the same cases and repeats. Its results appear beside the first setup when the comparison settings match.

The main Ladder has 80 tasks across Reasoning, Code, and Agent tasks. Visual web and Foldaway apartment are separate exploratory families. Quick check is the smallest harness check. A family describes the tasks; a preset supplies the model, harness, prompt, and evaluation settings.

**Rerun** prepares a new run with the source run's selection and effort. It uses current test definitions and the installed harness, so review the preview. **Resume** continues only the missing attempts of an interrupted run and keeps its original settings.

To remove a run, open **Results → Runs**, press **Delete run**, and confirm that exact run. To clear all history deliberately, open **Lab → Storage**, review the listed paths and run count, and type **DELETE ALL RUNS**. Deletion is permanent. Future runs remain saved until you choose to delete them.

On this machine, runs, ratings, saved views, and reports live in `.lab-data/` inside the project. **Lab → Storage** shows the actual paths. This folder is ignored by Git, so include it in your project backup. `lab.ledger.jsonl` stays beside the source code to check run integrity independently.
