echo "Running tests"

check_code()
{
   if [ $1 -eq 1 ]; then
	  echo "$2 has failed [error: $1]"
	  exit 1
  fi
}

# Run tests
yarn install

# Clone others direct dependencies we'd like to use for testing
git clone https://github.com/kalisio/feathers-distributed && cd feathers-distributed && yarn install && yarn link && cd ..
yarn link @kalisio/feathers-distributed

yarn test
check_code $? "Running tests"
