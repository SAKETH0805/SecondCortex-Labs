import os
import zipfile

def create_deploy_zip(source_dir, output_filename):
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            if '__pycache__' in root or '.git' in root or 'chroma_db' in root or 'extracted_logs' in root or '.venv' in root:
                continue
            for file in files:
                if file.endswith('.zip') or file.endswith('.db') or file == '.env':
                    continue
                file_path = os.path.join(root, file)
                # Ensure forward slashes for the archive name
                arcname = os.path.relpath(file_path, source_dir).replace('\\', '/')
                zipf.write(file_path, arcname)
    print(f"Created {output_filename} successfully with forward slashes!")

if __name__ == "__main__":
    create_deploy_zip('.', 'deploy_fix.zip')
