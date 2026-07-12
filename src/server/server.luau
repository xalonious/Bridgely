-- Place this Script in ServerScriptService and enable HTTP Requests for the experience.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local API_BASE_URL = "https://YOUR-DOMAIN.example.com" -- Replace with your API URL
local API_KEY = "12345" -- Replace with your api key

local function request(method: string, path: string, body: any?)
	local options = {
		Url = API_BASE_URL .. path,
		Method = method,
		Headers = {
			["Authorization"] = "Bearer " .. API_KEY,
			["Content-Type"] = "application/json",
		},
	}

	if body ~= nil then
		options.Body = HttpService:JSONEncode(body)
	end

	return HttpService:RequestAsync(options)
end

local function handlePlayer(player: Player)
	local pendingOk, pendingResponse = pcall(function()
		return request("GET", "/verification/pending/" .. tostring(player.UserId), nil)
	end)

	if not pendingOk or not pendingResponse.Success then
		player:Kick("You do not have a pending Bridgely verification. Start verification in Discord first.")
		return
	end

	local completeOk, completeResponse = pcall(function()
		return request("POST", "/verification/complete", {
			robloxUserId = player.UserId,
		})
	end)

	if not completeOk or not completeResponse.Success then
		player:Kick("Bridgely could not complete your verification. Return to Discord and try again.")
		return
	end

	player:Kick("Verification complete! You may now return to Discord.")
end

Players.PlayerAdded:Connect(function(player)
	task.spawn(handlePlayer, player)
end)
